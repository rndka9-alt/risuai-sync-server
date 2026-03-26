import http from 'http';
import crypto from 'crypto';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import * as config from './config';
import * as cache from './cache';
import * as sync from './sync';
import { buildClientJs, clientBundleHash } from './client-bundle';
import type { ClientMessage, HealthResponse } from '../shared/types';
import * as logger from './logger';
import { decodeProxy2Headers, forwardToLlm, isPrivateHost } from './utils/llmProxy';
import * as streamBuffer from './stream-buffer';
import { clients, aliveState, freshClients } from './serverState';
import { isTrustedClient } from './utils/isTrustedClient';
import { markClientTrusted } from './utils/markClientTrusted';
import { parseRisuSaveBlocks } from './parser';
import { reassembleRisuSave } from './utils/reassembleRisuSave';
import { injectSyncPlugin } from './utils/injectSyncPlugin';
import { SYNC_MARKER_KEY } from '../shared/syncMarker';
import { sendJson } from './utils/sendJson';
import { notifyWriteFailed } from './utils/notifyWriteFailed';
import { sendUpstreamWithRetry } from './utils/sendUpstreamWithRetry';
import { handleDeltaWrite, getCachedDbBinary, setCachedDbBinary } from './utils/deltaDbWrite';
import { handleBatchWrite } from './utils/batchWrite';
import { stripHeavyFields } from './utils/stripHeavyFields';
import { initAuth, issueInternalToken, isAuthReady } from './utils/risuAuth';
import { proxyRequest } from './utils/proxyRequest';
import { broadcastPlainFetchWarning } from './utils/broadcast';
import { verifyRisuAuth } from './utils/verifyRisuAuth';
import { handleClientLog } from './utils/handleClientLog';
import { hashRequestBody } from './utils/hashRequestBody';
import { pushLlmEvent, getActiveStreamIds } from './utils/monitorPush';
import { extractResponseMeta } from './llm-response-format/extractResponseMeta';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getUsePlainFetchFromDataCache(): boolean | null {
  const rootData = cache.dataCache.get('root');
  if (!isRecord(rootData)) return null;
  if (typeof rootData.usePlainFetch === 'boolean') {
    return rootData.usePlainFetch;
  }
  return null;
}

const wss = new WebSocketServer({ noServer: true });

const AUTH_TIMEOUT_MS = 10_000;

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId') || crypto.randomBytes(8).toString('hex');

  aliveState.set(ws, true);
  ws.on('pong', () => { aliveState.set(ws, true); });

  // Phase 1: 인증 대기 — AUTH_TIMEOUT_MS 내 auth 메시지 필요
  const authTimer = setTimeout(() => {
    logger.warn('Auth timeout, closing connection', { clientId });
    ws.close(4408, 'auth timeout');
  }, AUTH_TIMEOUT_MS);

  function registerAuthenticatedClient(): void {
    clients.set(clientId, ws);
    logger.info('Client authenticated', { clientId, total: String(clients.size) });

    ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        if (msg.type === 'init') {
          sync.initClientRootCache(clientId);
          return;
        }
        if (msg.type === 'caught-up') {
          freshClients.add(clientId);
          logger.info('Client caught up (fresh)', { clientId });
          return;
        }
        // stream-ack: 캐시 재생 방식 전환으로 더 이상 사용하지 않음.
        // 버퍼는 replay() 시 삭제되거나 TTL로 정리된다.
        if (msg.type === 'write-notify') {
          if (msg.file === config.DB_PATH) return;

          const payload = JSON.stringify({
            type: 'db-changed',
            file: msg.file || config.DB_PATH,
            timestamp: Date.now(),
          });
          for (const [id, client] of clients) {
            if (id !== clientId && client.readyState === 1) {
              client.send(payload);
            }
          }
        }
      } catch {
        // 파싱 실패 무시
      }
    });
  }

  // 인증 전 메시지 핸들러 — auth 이외의 메시지는 무시
  const onAuthMessage = (raw: WebSocket.RawData): void => {
    try {
      const parsed: Record<string, unknown> = JSON.parse(raw.toString());
      if (parsed.type !== 'auth' || typeof parsed.token !== 'string') return;

      clearTimeout(authTimer);
      ws.removeListener('message', onAuthMessage);

      // Grace period: 최근 인증된 clientId는 토큰 재검증 생략
      if (isTrustedClient(clientId)) {
        markClientTrusted(clientId);
        ws.send(JSON.stringify({ type: 'auth-result', success: true, epoch: cache.epoch }));
        registerAuthenticatedClient();
        return;
      }

      verifyRisuAuth(parsed.token).then((valid) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (!valid) {
          ws.send(JSON.stringify({ type: 'auth-result', success: false, epoch: cache.epoch }));
          ws.close(4401, 'unauthorized');
          return;
        }

        ws.send(JSON.stringify({ type: 'auth-result', success: true, epoch: cache.epoch }));
        markClientTrusted(clientId);
        registerAuthenticatedClient();
      }).catch(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4401, 'auth error');
        }
      });
    } catch {
      // parse error, ignore
    }
  };

  ws.on('message', onAuthMessage);

  ws.on('close', () => {
    clearTimeout(authTimer);
    aliveState.delete(ws);
    if (clients.get(clientId) === ws) {
      clients.delete(clientId);
      freshClients.delete(clientId);
      sync.removeClientCache(clientId);
      logger.info('Client disconnected', { clientId, total: String(clients.size) });
    }
  });
});

const heartbeatInterval = setInterval(() => {
  for (const [id, ws] of clients) {
    if (!aliveState.get(ws)) {
      ws.terminate();
      clients.delete(id);
      continue;
    }
    aliveState.set(ws, false);
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeatInterval));

function proxyDbWrite(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : null;
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const buffer = Buffer.concat(chunks);

    const seq = sync.reserveDbWrite();
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: config.UPSTREAM.host };
    delete headers[config.CLIENT_ID_HEADER];
    delete headers['x-sync-client-id'];

    sendUpstreamWithRetry(
      { path: req.url!, method: req.method!, headers, body: buffer },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);

        if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300) {
          setCachedDbBinary(buffer);
          setImmediate(() => sync.enqueueDbWrite(seq, buffer, senderClientId));
        } else {
          sync.skipDbWrite(seq);
        }
      },
      () => {
        sync.skipDbWrite(seq);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
        }
        res.end('Bad Gateway');
        notifyWriteFailed(senderClientId, req.url || '/api/write', config.RETRY_MAX_ATTEMPTS + 1);
      },
    );
  });
}

/** Remote block write 프록시 (Node 서버 모드: remotes/{charId}.local.bin) */
function proxyRemoteBlockWrite(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : null;
  const charId = sync.extractCharIdFromFilePath(req);

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let buffer: Buffer = Buffer.concat(chunks);

    // Stale 클라이언트: 서버 캐시와 union merge하여 데이터 소실 방지
    if (charId && senderClientId && !sync.isClientFresh(senderClientId)) {
      const merged = sync.mergeRemoteBlock(charId, buffer);
      if (merged) {
        buffer = merged;
      }
    }

    const seq = charId ? sync.reserveRemoteWrite(charId) : null;
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: config.UPSTREAM.host };
    delete headers[config.CLIENT_ID_HEADER];
    delete headers['x-sync-client-id'];
    headers['content-length'] = String(buffer.length);

    sendUpstreamWithRetry(
      { path: req.url!, method: req.method!, headers, body: buffer },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);

        if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300 && charId && seq !== null) {
          setImmediate(() => sync.enqueueRemoteWrite(seq, charId, buffer, senderClientId));
        } else if (seq !== null && charId) {
          sync.skipRemoteWrite(seq, charId);
        }
      },
      () => {
        if (seq !== null && charId) {
          sync.skipRemoteWrite(seq, charId);
        }
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
        }
        res.end('Bad Gateway');
        notifyWriteFailed(senderClientId, req.url || '/api/write', config.RETRY_MAX_ATTEMPTS + 1);
      },
    );
  });
}

/** proxy2 스트리밍 프록시 */
function isProxy2Post(req: http.IncomingMessage): boolean {
  return req.method === 'POST' && (req.url === '/proxy2' || req.url?.startsWith('/proxy2?') === true);
}

/** streamId → upstream 요청. abort 시 destroy용. */
const pendingUpstreams = new Map<string, http.ClientRequest>();

/** abort된 streamId 추적. onError에서 502 대신 cancel 응답을 보내기 위함. */
const abortedStreams = new Set<string>();

function proxyProxy2(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : 'unknown';
  const rawTargetCharId = req.headers[config.PROXY2_TARGET_HEADER];
  const targetCharId = typeof rawTargetCharId === 'string' ? rawTargetCharId : null;

  // LLM 직접 프록시 디코딩 시도 (body 소비 전에 헤더만 읽음)
  const decoded = decodeProxy2Headers(req);

  // Client disconnect tracking
  let clientDisconnected = false;
  let activeStreamId: string | null = null;
  let upstreamReq: http.ClientRequest | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const clearKeepAlive = (): void => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  res.on('close', () => {
    if (clientDisconnected) return;
    clientDisconnected = true;
    clearKeepAlive();

    // SSE 스트리밍 중이면 upstream을 유지 (재연결 가능)
    // sender가 끊겼음을 표시하여 stream-end broadcast에서 sender를 제외하지 않게 한다
    // 비-SSE 요청이면 upstream 중단
    if (activeStreamId) {
      sync.markSenderDisconnected(activeStreamId);
      logger.info('Client disconnected, stream buffered for reconnect', { streamId: activeStreamId, sender: senderClientId });
    } else if (upstreamReq && !upstreamReq.destroyed) {
      upstreamReq.destroy();
    }
  });

  // Body 버퍼링 (LLM 직접 호출 / upstream fallback 모두 필요)
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let body = Buffer.concat(chunks);

    // Body 수신 완료 전에 이미 연결 끊김
    if (clientDisconnected) return;

    // 방어적 마커 제거: LLM API에 마커가 전달되지 않도록 strip
    const bodyStr = body.toString('utf-8');
    const hadSyncMarker = bodyStr.includes(SYNC_MARKER_KEY);
    if (hadSyncMarker) {
      try {
        const parsed: Record<string, unknown> = JSON.parse(bodyStr);
        delete parsed[SYNC_MARKER_KEY];
        body = Buffer.from(JSON.stringify(parsed), 'utf-8');
      } catch { /* JSON 파싱 실패 시 원본 유지 */ }
    }

    // LLM 요청 판별: 플러그인이 주입한 sync marker 존재 시에만 모니터링
    const shouldMonitor = hadSyncMarker;
    const emitMonitorEvent: typeof pushLlmEvent = shouldMonitor ? pushLlmEvent : () => {};

    const llmTargetUrl = decoded ? decoded.targetUrl.href : '';
    const llmStartTime = Date.now();
    const streamId = crypto.randomBytes(8).toString('hex');

    emitMonitorEvent({
      type: 'start',
      streamId: streamId,
      sender: senderClientId,
      targetCharId,
      targetUrl: llmTargetUrl,
      requestBody: body.toString('utf-8'),
      timestamp: llmStartTime,
    });

    // 캐시 재생: 동일 요청에 대한 완료된 버퍼가 있으면 재생
    const hashTargetUrl = decoded ? decoded.targetUrl.href : (req.url || '/proxy2');
    const requestHash = hashRequestBody(body, hashTargetUrl);
    const cached = streamBuffer.findByHash(requestHash);
    if (cached) {
      if (cached.status === 'completed') {
        logger.info('Replaying cached response', { streamId: cached.id, sender: senderClientId, hash: requestHash.slice(0, 12) });
        if (!streamBuffer.replay(cached.id, res)) {
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('Cache replay failed');
        }
      } else {
        logger.info('Joining in-progress stream', { streamId: cached.id, sender: senderClientId, hash: requestHash.slice(0, 12) });
        if (!streamBuffer.subscribeRaw(cached.id, res)) {
          res.writeHead(502, { 'content-type': 'text/plain' });
          res.end('Stream subscribe failed');
        }
      }
      emitMonitorEvent({
        type: 'end',
        streamId: streamId,
        responseType: 'cache',
        duration: Date.now() - llmStartTime,
        textLength: streamBuffer.getTextLength(cached.id),
        outputPreview: streamBuffer.getAccumulatedText(cached.id),
        status: cached.httpStatus,
      });
      return;
    }

    // SSE 응답 공통 핸들러
    const onResponse = (proxyRes: http.IncomingMessage): void => {
      clearKeepAlive();
      pendingUpstreams.delete(streamId);
      const contentType = proxyRes.headers['content-type'] || '';
      const isSSE = contentType.includes('text/event-stream');

      if (!isSSE) {
        const nonStreamId = crypto.randomBytes(8).toString('hex');
        const responseHeaders = { ...proxyRes.headers, 'x-sync-stream-id': nonStreamId };

        if (!clientDisconnected && !res.headersSent) {
          res.writeHead(proxyRes.statusCode!, responseHeaders);
        }

        const resChunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => {
          if (!clientDisconnected) res.write(chunk);
          resChunks.push(chunk);
        });
        proxyRes.on('end', () => {
          const responseBody = Buffer.concat(resChunks);
          const extractedText = streamBuffer.storeResponse(
            nonStreamId, senderClientId, targetCharId,
            proxyRes.statusCode!, proxyRes.headers, responseBody,
          );
          streamBuffer.setRequestHash(nonStreamId, requestHash);

          if (extractedText) {
            sync.broadcastResponseCompleted(
              nonStreamId, senderClientId, targetCharId, extractedText,
            );
          }

          const resContentType = typeof proxyRes.headers['content-type'] === 'string'
            ? proxyRes.headers['content-type']
            : '';
          const meta = extractResponseMeta(responseBody, resContentType);
          emitMonitorEvent({
            type: 'end',
            streamId: streamId,
            responseType: 'non-sse',
            duration: Date.now() - llmStartTime,
            textLength: extractedText.length,
            outputPreview: extractedText,
            status: proxyRes.statusCode,
            responseContentType: resContentType,
            responseBody: responseBody.toString('base64'),
            finishReason: meta.finishReason,
            outputTokens: meta.outputTokens,
            reasoningTokens: meta.reasoningTokens,
          });

          if (!clientDisconnected && !res.writableEnded) res.end();
        });
        return;
      }

      // SSE streaming response — buffer + tee
      activeStreamId = streamId;
      logger.info('Stream started', { streamId, sender: senderClientId, targetCharId: targetCharId || 'unknown' });

      sync.createStream(streamId, senderClientId, targetCharId);
      if (upstreamReq) {
        streamBuffer.create(streamId, senderClientId, targetCharId, upstreamReq, llmTargetUrl);
      }
      streamBuffer.setRequestHash(streamId, requestHash);

      // x-sync-stream-id: 클라이언트가 재연결할 때 사용
      const responseHeaders = { ...proxyRes.headers, 'x-sync-stream-id': streamId };
      streamBuffer.setResponseMeta(streamId, proxyRes.statusCode!, responseHeaders);

      if (!clientDisconnected && !res.headersSent) {
        res.writeHead(proxyRes.statusCode!, responseHeaders);
      }

      proxyRes.on('data', (chunk: Buffer) => {
        if (!clientDisconnected) res.write(chunk);
        sync.processStreamChunk(streamId, chunk);
        streamBuffer.addChunk(streamId, chunk);
      });

      proxyRes.on('end', () => {
        logger.info('Stream ended', { streamId });
        const rawBody = streamBuffer.getRawResponseBody(streamId);
        const sseMeta = rawBody
          ? extractResponseMeta(rawBody, 'text/event-stream')
          : { finishReason: '', outputTokens: 0 };
        emitMonitorEvent({
          type: 'end',
          streamId: streamId,
          responseType: 'sse',
          duration: Date.now() - llmStartTime,
          textLength: streamBuffer.getTextLength(streamId),
          outputPreview: streamBuffer.getAccumulatedText(streamId),
          status: proxyRes.statusCode,
          responseContentType: 'text/event-stream',
          ...(rawBody ? { responseBody: rawBody.toString('base64') } : {}),
          finishReason: sseMeta.finishReason,
          outputTokens: sseMeta.outputTokens,
          reasoningTokens: sseMeta.reasoningTokens,
        });
        if (activeStreamId === streamId) {
          sync.endStream(streamId);
          activeStreamId = null;
        }
        streamBuffer.complete(streamId);
        if (!clientDisconnected && !res.writableEnded) res.end();
      });

      proxyRes.on('error', (err) => {
        // abort()로 인한 에러는 정상 흐름
        if (!clientDisconnected) {
          logger.error('Stream error', { streamId, error: err.message });
        }
        const rawBodyOnErr = streamBuffer.getRawResponseBody(streamId);
        const errMeta = rawBodyOnErr
          ? extractResponseMeta(rawBodyOnErr, 'text/event-stream')
          : { finishReason: '', outputTokens: 0 };
        emitMonitorEvent({
          type: 'end',
          streamId: streamId,
          responseType: 'sse',
          duration: Date.now() - llmStartTime,
          textLength: streamBuffer.getTextLength(streamId),
          outputPreview: streamBuffer.getAccumulatedText(streamId),
          status: 0,
          error: err.message,
          responseContentType: 'text/event-stream',
          ...(rawBodyOnErr ? { responseBody: rawBodyOnErr.toString('base64') } : {}),
          finishReason: errMeta.finishReason,
          outputTokens: errMeta.outputTokens,
          reasoningTokens: errMeta.reasoningTokens,
        });
        if (activeStreamId === streamId) {
          sync.endStream(streamId);
          activeStreamId = null;
        }
        streamBuffer.fail(streamId, err.message);
        if (!clientDisconnected && !res.writableEnded) res.end();
      });
    };

    const onError = (err: Error): void => {
      clearKeepAlive();
      pendingUpstreams.delete(streamId);
      const wasAborted = abortedStreams.delete(streamId);
      emitMonitorEvent({
        type: 'end',
        streamId: streamId,
        responseType: wasAborted ? 'aborted' : 'error',
        duration: Date.now() - llmStartTime,
        textLength: 0,
        outputPreview: '',
        status: wasAborted ? 0 : 502,
        error: wasAborted ? '' : err.message,
      });
      if (clientDisconnected) return;
      if (wasAborted) {
        const cancelText = '*유저에 의해 요청이 취소되었습니다*';
        const isAnthropic = llmTargetUrl.includes('anthropic');
        const body = isAnthropic
          ? { content: [{ type: 'text', text: cancelText }], stop_reason: 'end_turn', role: 'assistant' }
          : { choices: [{ message: { content: cancelText, role: 'assistant' }, finish_reason: 'stop', index: 0 }] };
        if (!res.headersSent) {
          res.writeHead(200, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify(body));
        return;
      }
      logger.error('proxy2 error', { error: err.message });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('Bad Gateway');
    };

    if (decoded) {
      // SSRF 방어: private/internal 네트워크 차단
      if (isPrivateHost(decoded.targetUrl.hostname)) {
        logger.warn('Blocked SSRF attempt to private host', { hostname: decoded.targetUrl.hostname });
        emitMonitorEvent({
          type: 'end', streamId, responseType: 'error',
          duration: 0, textLength: 0, outputPreview: '', status: 403,
          error: 'private_host_blocked',
        });
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'private_host_blocked' }));
        return;
      }
      // LLM API 직접 호출
      if (!decoded.headers['x-forwarded-for']) {
        const remoteAddr = req.socket.remoteAddress;
        if (remoteAddr) decoded.headers['x-forwarded-for'] = remoteAddr;
      }
      upstreamReq = forwardToLlm(decoded, body, onResponse, onError);
      pendingUpstreams.set(streamId, upstreamReq);
    } else {
      // risu-url 없음 → upstream fallback
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
        host: config.UPSTREAM.host,
      };
      delete headers[config.CLIENT_ID_HEADER];
      delete headers['x-sync-client-id'];
      delete headers[config.PROXY2_TARGET_HEADER];
      headers['content-length'] = String(body.length);

      upstreamReq = http.request(
        {
          hostname: config.UPSTREAM.hostname,
          port: config.UPSTREAM.port,
          path: req.url,
          method: req.method,
          headers,
        },
        onResponse,
      );
      upstreamReq.on('error', onError);
      upstreamReq.end(body);
      pendingUpstreams.set(streamId, upstreamReq);
    }

    // Cloudflare 프록시 타임아웃(100s) 방지:
    // upstream 응답 대기 중 30초마다 공백 바이트를 전송하여 연결을 유지한다.
    // JSON 파서는 선행 공백을 무시하므로 응답 파싱에 영향 없음.
    keepAliveTimer = setInterval(() => {
      if (clientDisconnected || res.writableEnded) {
        clearKeepAlive();
        return;
      }
      if (!res.headersSent) {
        res.writeHead(200);
      }
      res.write(' ');
    }, 30_000);
  });
}

/** 인증된 /sync/* 라우트 핸들러 */
function handleAuthenticatedSyncRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): void {
  if (req.method === 'GET' && url.pathname === '/sync/block') {
    const name = url.searchParams.get('name');
    if (!name) {
      sendJson(res, 400, { error: 'missing name parameter' });
      return;
    }
    const rawData = cache.dataCache.get(name);
    if (rawData === null) {
      sendJson(res, 404, { error: 'block not found in cache' });
      return;
    }
    const jsonStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
    const hashEntry = cache.hashCache.get(name);
    const resHeaders: Record<string, string | number> = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(jsonStr),
    };
    if (hashEntry) resHeaders['x-block-hash'] = hashEntry.hash;
    res.writeHead(200, resHeaders);
    res.end(jsonStr);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sync/changes') {
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    const clientId = url.searchParams.get('clientId');
    const result = cache.getChangesSince(since, clientId);

    // 보관소: 미수신 완료 스트림 첨부
    if (result.status === 200 && 'changes' in result.data) {
      const pending = streamBuffer.getCompletedPending();
      if (pending.length > 0) {
        result.data.pendingStreams = pending.map((p) => ({
          id: p.id,
          targetCharId: p.targetCharId,
          text: p.accumulatedText,
        }));
      }
    }

    sendJson(res, result.status, result.data);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sync/manifest') {
    sendJson(res, 200, cache.getManifest());
    return;
  }

  // --- Stream reconnection ---
  if (req.method === 'GET' && url.pathname === '/sync/streams/active') {
    sendJson(res, 200, { streams: streamBuffer.getActiveStreams() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/sync/log') {
    handleClientLog(req, res);
    return;
  }


  const streamMatch = url.pathname.match(/^\/sync\/stream\/([^/]+)$/);
  if (req.method === 'GET' && streamMatch) {
    if (!streamBuffer.subscribe(streamMatch[1], res)) {
      sendJson(res, 404, { error: 'stream not found' });
    }
    return;
  }

  const abortMatch = url.pathname.match(/^\/sync\/stream\/([^/]+)\/abort$/);
  if (req.method === 'POST' && abortMatch) {
    const streamId = abortMatch[1];
    if (streamBuffer.abort(streamId)) {
      sync.endStream(streamId);
      sendJson(res, 200, { success: true });
    } else {
      sendJson(res, 404, { error: 'stream not found or already finished' });
    }
    return;
  }
}

/** HTTP 서버 */
const server = http.createServer((req, res) => {
  const reqStart = performance.now();

  // Propagate or generate request ID for cross-service tracing
  const rid = (typeof req.headers[config.REQUEST_ID_HEADER] === 'string' && req.headers[config.REQUEST_ID_HEADER])
    || (typeof req.headers['cf-ray'] === 'string' && req.headers['cf-ray'])
    || crypto.randomBytes(8).toString('hex');
  req.headers[config.REQUEST_ID_HEADER] = rid;

  // Ensure client ID header is always present — client patch may not be loaded.
  // Fallback: 구 버전 클라이언트가 x-sync-client-id를 보낼 수 있음 (헤더 이름 변경 이전 캐시).
  if (typeof req.headers[config.CLIENT_ID_HEADER] !== 'string') {
    const legacyId = req.headers['x-sync-client-id'];
    if (typeof legacyId === 'string') {
      req.headers[config.CLIENT_ID_HEADER] = legacyId;
    } else {
      req.headers[config.CLIENT_ID_HEADER] = `srv-${crypto.randomBytes(8).toString('hex')}`;
    }
  }

  logger.debug('Request', { rid, method: req.method, url: req.url, clientId: req.headers[config.CLIENT_ID_HEADER] });

  res.on('finish', () => {
    const duration = (performance.now() - reqStart).toFixed(0);
    const logFields: Record<string, string | undefined> = { rid, method: req.method, url: req.url, status: String(res.statusCode), ms: duration };
    // file-path 헤더가 있으면 디코딩해서 로그에 포함 (backup 이슈 추적용)
    const rawFp = req.headers[config.FILE_PATH_HEADER];
    if (typeof rawFp === 'string' && rawFp.length > 0) {
      logFields.filePath = sync.hexDecodeFilePath(rawFp);
    }
    logger.info('Response', logFields);
  });

  // --- /_internal/* (인증 불필요, Caddy에서 외부 차단) ---
  if (req.method === 'GET' && req.url === '/_internal/streams') {
    const now = Date.now();
    const activeIds = getActiveStreamIds();
    const active = Array.from(activeIds, (id) => ({ id }));
    const recent = streamBuffer.getRecentStreamsDetailed(5).map((s) => ({
      ...s,
      elapsedMs: (s.completedAt ?? now) - s.createdAt,
    }));
    sendJson(res, 200, { active, recent, total: active.length });
    return;
  }

  const internalAbortMatch = req.url?.match(/^\/_internal\/stream\/([^/]+)\/abort$/);
  if (req.method === 'POST' && internalAbortMatch) {
    const abortId = internalAbortMatch[1];
    const pending = pendingUpstreams.get(abortId);
    if (pending) {
      abortedStreams.add(abortId);
      pendingUpstreams.delete(abortId);
      if (!pending.destroyed) pending.destroy(new Error('cancelled'));
      sendJson(res, 200, { success: true });
    } else if (streamBuffer.abort(abortId)) {
      sync.endStream(abortId);
      sendJson(res, 200, { success: true });
    } else {
      sendJson(res, 404, { error: 'stream not found or already finished' });
    }
    return;
  }

  // --- /sync/* 경로 ---
  if (req.url!.startsWith('/sync/')) {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/sync/client.js') {
      const js = buildClientJs();
      // ?v= 쿼리가 있으면 immutable (hash 기반 cache-busting), 없으면 no-store
      const hasVersion = url.searchParams.has('v');
      const cacheControl = hasVersion
        ? 'public, max-age=31536000, immutable'
        : 'no-store';
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'content-length': Buffer.byteLength(js),
        'cache-control': cacheControl,
      });
      res.end(js);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sync/health') {
      const health: HealthResponse = {
        status: 'ok',
        epoch: cache.epoch,
        clients: clients.size,
        version: cache.currentVersion,
        cacheInitialized: cache.cacheInitialized,
        cachedBlocks: cache.hashCache.size,
      };
      sendJson(res, 200, health);
      return;
    }

    // /sync/delta-write
    if (req.method === 'POST' && url.pathname === '/sync/delta-write') {
      const remoteWriteOps = { reserveRemoteWrite: sync.reserveRemoteWrite, enqueueRemoteWrite: sync.enqueueRemoteWrite, skipRemoteWrite: sync.skipRemoteWrite };
      const httpClientId = typeof req.headers[config.CLIENT_ID_HEADER] === 'string'
        ? req.headers[config.CLIENT_ID_HEADER]
        : null;
      if (isTrustedClient(httpClientId)) {
        handleDeltaWrite(req, res, sync.processDbWrite, remoteWriteOps, notifyWriteFailed);
        return;
      }
      const risuAuth = req.headers[config.RISU_AUTH_HEADER];
      if (typeof risuAuth !== 'string') {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      verifyRisuAuth(risuAuth).then((valid) => {
        if (!valid) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        handleDeltaWrite(req, res, sync.processDbWrite, remoteWriteOps, notifyWriteFailed);
      }).catch(() => {
        if (!res.headersSent) sendJson(res, 502, { error: 'auth verification failed' });
      });
      return;
    }

    // /sync/batch-write — 에셋 등 다수 파일을 한 요청으로 묶어 upstream 전달
    if (req.method === 'POST' && url.pathname === '/sync/batch-write') {
      const httpClientId = typeof req.headers[config.CLIENT_ID_HEADER] === 'string'
        ? req.headers[config.CLIENT_ID_HEADER]
        : null;
      if (isTrustedClient(httpClientId)) {
        handleBatchWrite(req, res);
        return;
      }
      const risuAuth = req.headers[config.RISU_AUTH_HEADER];
      if (typeof risuAuth !== 'string') {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      verifyRisuAuth(risuAuth).then((valid) => {
        if (!valid) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        handleBatchWrite(req, res);
      }).catch(() => {
        if (!res.headersSent) sendJson(res, 502, { error: 'auth verification failed' });
      });
      return;
    }

    // /sync/backup — cached database.bin으로 dbbackup write (클라이언트 6.6MB 업로드 제거)
    if (req.method === 'POST' && url.pathname === '/sync/backup') {
      const handleBackup = () => {
        const cached = getCachedDbBinary();
        if (!cached) {
          sendJson(res, 409, { error: 'no_cache' });
          return;
        }
        const backupPath = `database/dbbackup-${(Date.now() / 100).toFixed()}.bin`;
        const headers: Record<string, string | string[] | undefined> = {
          ...req.headers,
          host: config.UPSTREAM.host,
          'file-path': Buffer.from(backupPath, 'utf-8').toString('hex'),
          'content-type': 'application/octet-stream',
          'content-length': String(cached.length),
        };
        delete headers[config.CLIENT_ID_HEADER];
        delete headers['x-sync-client-id'];
        sendUpstreamWithRetry(
          { path: '/api/write', method: 'POST', headers, body: cached },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          },
          () => {
            if (!res.headersSent) {
              res.writeHead(502, { 'content-type': 'text/plain' });
            }
            res.end('Bad Gateway');
          },
        );
      };
      const httpClientId = typeof req.headers[config.CLIENT_ID_HEADER] === 'string'
        ? req.headers[config.CLIENT_ID_HEADER]
        : null;
      if (isTrustedClient(httpClientId)) {
        handleBackup();
        return;
      }
      const risuAuth = req.headers[config.RISU_AUTH_HEADER];
      if (typeof risuAuth !== 'string') {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      verifyRisuAuth(risuAuth).then((valid) => {
        if (!valid) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        handleBackup();
      }).catch(() => {
        if (!res.headersSent) sendJson(res, 502, { error: 'auth verification failed' });
      });
      return;
    }

    // /sync/client.js, /sync/health 이외의 엔드포인트는 인증 필요
    // Grace period: 최근 WS 인증된 clientId는 토큰 재검증 생략
    const httpClientId = typeof req.headers[config.CLIENT_ID_HEADER] === 'string'
      ? req.headers[config.CLIENT_ID_HEADER]
      : null;
    if (isTrustedClient(httpClientId)) {
      handleAuthenticatedSyncRoute(req, res, url);
      return;
    }

    const risuAuth = req.headers[config.RISU_AUTH_HEADER];
    if (typeof risuAuth !== 'string') {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    verifyRisuAuth(risuAuth).then((valid) => {
      if (!valid) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      handleAuthenticatedSyncRoute(req, res, url);
    }).catch(() => {
      if (!res.headersSent) sendJson(res, 502, { error: 'auth verification failed' });
    });
    return;
  }

  // --- GET /.proxy/config → 체이닝 프록시 설정 ---
  if (req.method === 'GET' && req.url === '/.proxy/config') {
    const configReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: '/.proxy/config',
        method: 'GET',
        headers: { ...req.headers, host: config.UPSTREAM.host },
      },
      (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let upstream: Record<string, unknown> = {};
          if (proxyRes.statusCode === 200) {
            try {
              const parsed: Record<string, unknown> = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (typeof parsed === 'object' && parsed !== null) {
                upstream = parsed;
              }
            } catch { /* start fresh */ }
          }

          upstream['sync'] = {
            clients: clients.size,
            cacheInitialized: cache.cacheInitialized,
            usePlainFetch: getUsePlainFetchFromDataCache(),
          };

          const body = JSON.stringify(upstream);
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
            'cache-control': 'no-cache',
          });
          res.end(body);
        });
      },
    );

    configReq.on('error', () => {
      const body = JSON.stringify({
        sync: {
          clients: clients.size,
          cacheInitialized: cache.cacheInitialized,
          usePlainFetch: getUsePlainFetchFromDataCache(),
        },
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-cache',
      });
      res.end(body);
    });

    configReq.end();
    return;
  }

  // --- GET / → 프록시 + HTML 주입 ---
  if (req.method === 'GET' && (req.url === '/' || req.url === '/?')) {
    const proxyReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: req.url,
        method: 'GET',
        headers: { ...req.headers, host: config.UPSTREAM.host },
      },
      (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = html.replace('</head>', config.getScriptTag(clientBundleHash) + '</head>');

          const resHeaders = { ...proxyRes.headers };
          resHeaders['content-length'] = String(Buffer.byteLength(html));
          delete resHeaders['content-encoding'];
          delete resHeaders['transfer-encoding'];

          res.writeHead(proxyRes.statusCode!, resHeaders);
          res.end(html);
        });
      },
    );
    proxyReq.setHeader('accept-encoding', 'identity');
    proxyReq.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway');
    });
    proxyReq.end();
    return;
  }

  // --- DB write → 버퍼링 프록시 ---
  if (sync.isDbWrite(req)) {
    proxyDbWrite(req, res);
    return;
  }

  // --- Remote block write → 버퍼링 프록시 (Node 서버 모드) ---
  if (sync.isRemoteBlockWrite(req)) {
    proxyRemoteBlockWrite(req, res);
    return;
  }

  // --- POST /proxy2 → 스트리밍 인식 프록시 ---
  if (isProxy2Post(req)) {
    proxyProxy2(req, res);
    return;
  }

  // --- GET /api/list → .meta.meta 이상 필터링 ---
  // risuai 클라이언트 버그: cleanup 루프가 .meta 파일에도 .meta를 덧붙여
  // .meta.meta.meta... 체인이 무한 성장 → ENAMETOOLONG 500.
  // .meta.meta 이상을 list에서 숨겨 체인 성장을 차단한다.
  if (req.method === 'GET' && req.url === '/api/list') {
    const proxyReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: config.UPSTREAM.host },
      },
      (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          try {
            const data = JSON.parse(body.toString('utf-8'));
            if (data.content && Array.isArray(data.content)) {
              data.content = data.content.filter((entry: string) => !entry.includes('.meta.meta'));
            }
            const filtered = JSON.stringify(data);
            const resHeaders = { ...proxyRes.headers };
            resHeaders['content-length'] = String(Buffer.byteLength(filtered));
            delete resHeaders['transfer-encoding'];
            res.writeHead(proxyRes.statusCode!, resHeaders);
            res.end(filtered);
          } catch {
            res.writeHead(proxyRes.statusCode!, proxyRes.headers);
            res.end(body);
          }
        });
      },
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway');
    });
    proxyReq.end();
    return;
  }

  // --- database.bin read → 플러그인 주입 + usePlainFetch 감지 ---
  if (sync.isDbRead(req)) {
    const proxyReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: config.UPSTREAM.host },
      },
      (proxyRes) => {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        proxyRes.on('end', () => {
          const originalBuf = Buffer.concat(chunks);
          let responseBuf = originalBuf;

          if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300) {
            // delta-write 캐시: 클라이언트 최초 read 시 채움
            setCachedDbBinary(originalBuf);

            try {
              const parsed = parseRisuSaveBlocks(originalBuf);
              if (parsed) {
                const rootBlock = parsed.blocks.get('root');
                if (rootBlock) {
                  const root: Record<string, unknown> = JSON.parse(rootBlock.json);
                  if (root.usePlainFetch === true) {
                    broadcastPlainFetchWarning();
                  }

                  // Phase 1: ROOT.modules 중복 제거 (MODULES 블록에 동일 데이터 존재)
                  const strippedJson = stripHeavyFields(rootBlock.json);

                  // Phase 2: sync 플러그인 주입
                  const finalJson = injectSyncPlugin(strippedJson);

                  // Phase 3: 바이너리 재조립 (변경이 있을 때만)
                  if (finalJson !== rootBlock.json) {
                    const reassembled = reassembleRisuSave(originalBuf, finalJson);
                    if (reassembled) responseBuf = reassembled;
                  }
                }
              }
            } catch { /* fallback: 원본 전송 */ }
          }

          const headers = { ...proxyRes.headers };
          headers['content-length'] = String(responseBuf.length);
          delete headers['transfer-encoding'];
          res.writeHead(proxyRes.statusCode!, headers);
          res.end(responseBuf);
        });
      },
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway');
    });
    proxyReq.end();
    return;
  }

  // --- 그 외 → 투명 프록시 ---
  proxyRequest(req, res);
});

/** WebSocket upgrade */
server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === '/sync/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }

  // 그 외 → upstream 투명 전달
  const proxyReq = http.request({
    hostname: config.UPSTREAM.hostname,
    port: config.UPSTREAM.port,
    path: req.url,
    method: 'GET',
    headers: req.headers,
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n` +
      Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n',
    );
    if (proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
});

/** 서버 시작 */
server.listen(config.PORT, () => {
  logger.info(`Server listening on port ${config.PORT}`);
  logger.info(`Upstream: ${config.UPSTREAM.href}`);
  logger.info(`DB path: ${config.DB_PATH}`);
  logger.info(`Max log entries: ${config.MAX_LOG_ENTRIES}`);
  logger.info(`Log level: ${config.LOG_LEVEL}`);

  // Self-auth → proactive database.bin fetch (non-blocking)
  (async () => {
    await initAuth().catch((e) => logger.warn('Self-auth error', { error: String(e) }));
    if (!isAuthReady()) return;

    const token = await issueInternalToken();
    if (!token) return;

    try {
      const hexPath = Buffer.from(config.DB_PATH, 'utf-8').toString('hex');
      const resp = await fetch(`${config.UPSTREAM.protocol}//${config.UPSTREAM.host}/api/read`, {
        method: 'GET',
        headers: {
          [config.FILE_PATH_HEADER]: hexPath,
          [config.RISU_AUTH_HEADER]: token,
        },
      });

      if (resp.ok) {
        const body = Buffer.from(await resp.arrayBuffer());
        if (body.length > 0) {
          setCachedDbBinary(body);
          sync.processDbWrite(body, null);
          logger.info('Proactive database.bin fetch completed', { bodyKB: String((body.length / 1024).toFixed(0)) });
        }
      }
    } catch (e) {
      logger.warn('Proactive database.bin fetch failed', { error: String(e) });
    }
  })();
});
