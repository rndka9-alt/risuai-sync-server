import http from 'http';
import crypto from 'crypto';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import * as config from './config';
import * as cache from './cache';
import * as sync from './sync';
import { buildClientJs, clientBundleHash } from './client-bundle';
import type { ClientMessage, HealthResponse, ServerMessage } from '../shared/types';
import * as logger from './logger';
import { decodeProxy2Headers, forwardToLlm } from './llm-proxy';
import * as streamBuffer from './stream-buffer';

/** WebSocket 연결 관리 */
const clients = new Map<string, WebSocket>();
const aliveState = new WeakMap<WebSocket, boolean>();
const wss = new WebSocketServer({ noServer: true });

sync.init(clients);

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId') || crypto.randomBytes(8).toString('hex');

  clients.set(clientId, ws);
  aliveState.set(ws, true);
  logger.info('Client connected', { clientId, total: String(clients.size) });

  ws.on('pong', () => { aliveState.set(ws, true); });

  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
      if (msg.type === 'init') {
        // 클라이언트 첫 연결: 글로벌 ROOT 캐시를 per-client 캐시로 복사 (echo 방지 baseline)
        sync.initClientRootCache(clientId);
        return;
      }
      if (msg.type === 'stream-ack') {
        streamBuffer.acknowledge(msg.streamId);
        return;
      }
      if (msg.type === 'write-notify') {
        // DB write는 서버 프록시에서 감지하므로 여기서는 무시
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

  ws.on('close', () => {
    // 같은 clientId로 재연결된 경우, 새 ws를 삭제하지 않도록 본인 확인
    if (clients.get(clientId) === ws) {
      clients.delete(clientId);
    }
    sync.removeClientCache(clientId);
    logger.info('Client disconnected', { clientId, total: String(clients.size) });
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

/** HTTP 유틸 */
function sendJson(res: http.ServerResponse, statusCode: number, data: object): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Write 실패 시 WebSocket으로 sender에게 알림 */
function notifyWriteFailed(senderClientId: string | null, path: string, attempts: number): void {
  if (!senderClientId) return;
  const ws = clients.get(senderClientId);
  if (!ws || ws.readyState !== 1) return;
  const msg: ServerMessage = {
    type: 'write-failed',
    path,
    attempts,
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(msg));
}

/** Upstream 프록시 + 재시도 (buffered body 전용) */
function sendUpstreamWithRetry(
  options: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  },
  onResponse: (proxyRes: http.IncomingMessage) => void,
  onAllFailed: () => void,
  attempt: number = 0,
): void {
  const proxyReq = http.request(
    {
      hostname: config.UPSTREAM.hostname,
      port: config.UPSTREAM.port,
      path: options.path,
      method: options.method,
      headers: options.headers,
    },
    onResponse,
  );

  proxyReq.on('error', (err) => {
    if (attempt < config.RETRY_MAX_ATTEMPTS) {
      const delay = config.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn('Upstream error, retrying', {
        attempt: String(attempt + 1),
        maxAttempts: String(config.RETRY_MAX_ATTEMPTS),
        delay: `${delay}ms`,
        error: err.message,
        path: options.path,
      });
      setTimeout(() => sendUpstreamWithRetry(options, onResponse, onAllFailed, attempt + 1), delay);
    } else {
      logger.error('Upstream error, all retries exhausted', {
        attempts: String(attempt + 1),
        error: err.message,
        path: options.path,
      });
      onAllFailed();
    }
  });

  proxyReq.write(options.body);
  proxyReq.end();
}

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const t0 = performance.now();
  const rid = req.headers[config.REQUEST_ID_HEADER] || '';

  const proxyReq = http.request(
    {
      hostname: config.UPSTREAM.hostname,
      port: config.UPSTREAM.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: config.UPSTREAM.host },
    },
    (proxyRes) => {
      logger.debug('upstream TTFB', { rid, url: req.url, ms: (performance.now() - t0).toFixed(0) });
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  req.pipe(proxyReq);
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
    }
    res.end('Bad Gateway');
  });
}

function proxyDbWrite(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : null;
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const buffer = Buffer.concat(chunks);

    // Streaming protection: 다른 기기의 스트리밍 중 write 차단
    if (sync.isWriteBlockedByStream(senderClientId)) {
      logger.warn('Write blocked (streaming in progress)', { sender: senderClientId || 'unknown' });
      sendJson(res, 409, { error: 'streaming_in_progress', message: 'Write blocked: streaming in progress' });
      return;
    }

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
    const buffer = Buffer.concat(chunks);

    if (sync.isWriteBlockedByStream(senderClientId)) {
      logger.warn('Remote write blocked (streaming in progress)', { sender: senderClientId || 'unknown' });
      sendJson(res, 409, { error: 'streaming_in_progress', message: 'Write blocked: streaming in progress' });
      return;
    }

    const seq = charId ? sync.reserveRemoteWrite(charId) : null;
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: config.UPSTREAM.host };
    delete headers[config.CLIENT_ID_HEADER];
    delete headers['x-sync-client-id'];

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

function proxyProxy2(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : 'unknown';
  const rawTargetCharId = req.headers[config.PROXY2_TARGET_HEADER];
  const targetCharId = typeof rawTargetCharId === 'string' ? rawTargetCharId : null;

  // Streaming protection: 동일 캐릭터에 대한 다른 기기의 proxy2 요청 차단
  const existingStream = sync.findActiveStreamForChar(targetCharId);
  if (existingStream && existingStream.senderClientId !== senderClientId) {
    logger.warn('proxy2 blocked (active stream)', {
      sender: senderClientId,
      targetCharId: targetCharId || 'unknown',
      existingStreamId: existingStream.id,
    });
    sendJson(res, 409, {
      error: 'streaming_in_progress',
      streamId: existingStream.id,
      targetCharId: existingStream.targetCharId,
    });
    return;
  }

  // LLM 직접 프록시 디코딩 시도 (body 소비 전에 헤더만 읽음)
  const decoded = decodeProxy2Headers(req);

  // Client disconnect tracking
  let clientDisconnected = false;
  let activeStreamId: string | null = null;
  let upstreamReq: http.ClientRequest | null = null;

  res.on('close', () => {
    if (clientDisconnected) return;
    clientDisconnected = true;

    // SSE 스트리밍 중이면 upstream을 유지 (재연결 가능)
    // 비-SSE 요청이면 upstream 중단
    if (activeStreamId) {
      logger.info('Client disconnected, stream buffered for reconnect', { streamId: activeStreamId, sender: senderClientId });
    } else if (upstreamReq && !upstreamReq.destroyed) {
      upstreamReq.destroy();
    }
  });

  // Body 버퍼링 (LLM 직접 호출 / upstream fallback 모두 필요)
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    // Body 수신 완료 전에 이미 연결 끊김
    if (clientDisconnected) return;

    // SSE 응답 공통 핸들러
    const onResponse = (proxyRes: http.IncomingMessage): void => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isSSE = contentType.includes('text/event-stream');

      if (!isSSE) {
        const nonStreamId = crypto.randomBytes(8).toString('hex');
        const responseHeaders = { ...proxyRes.headers, 'x-sync-stream-id': nonStreamId };

        if (!clientDisconnected) {
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

          if (extractedText) {
            sync.broadcastResponseCompleted(
              nonStreamId, senderClientId, targetCharId, extractedText,
            );
          }

          if (!clientDisconnected && !res.writableEnded) res.end();
        });
        return;
      }

      // SSE streaming response — buffer + tee
      const streamId = crypto.randomBytes(8).toString('hex');
      activeStreamId = streamId;
      logger.info('Stream started', { streamId, sender: senderClientId, targetCharId: targetCharId || 'unknown' });

      sync.createStream(streamId, senderClientId, targetCharId);
      streamBuffer.create(streamId, senderClientId, targetCharId, upstreamReq!);

      // x-sync-stream-id: 클라이언트가 재연결할 때 사용
      const responseHeaders = { ...proxyRes.headers, 'x-sync-stream-id': streamId };

      if (!clientDisconnected) {
        res.writeHead(proxyRes.statusCode!, responseHeaders);
      }

      proxyRes.on('data', (chunk: Buffer) => {
        if (!clientDisconnected) res.write(chunk);
        sync.processStreamChunk(streamId, chunk);
        streamBuffer.addChunk(streamId, chunk);
      });

      proxyRes.on('end', () => {
        logger.info('Stream ended', { streamId });
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
        if (activeStreamId === streamId) {
          sync.endStream(streamId);
          activeStreamId = null;
        }
        streamBuffer.fail(streamId, err.message);
        if (!clientDisconnected && !res.writableEnded) res.end();
      });
    };

    const onError = (err: Error): void => {
      if (clientDisconnected) return;
      logger.error('proxy2 error', { error: err.message });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('Bad Gateway');
    };

    if (decoded) {
      // LLM API 직접 호출
      if (!decoded.headers['x-forwarded-for']) {
        const remoteAddr = req.socket.remoteAddress;
        if (remoteAddr) decoded.headers['x-forwarded-for'] = remoteAddr;
      }
      upstreamReq = forwardToLlm(decoded, body, onResponse, onError);
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
    }
  });
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

    if (req.method === 'GET' && url.pathname === '/sync/block') {
      const name = url.searchParams.get('name');
      if (!name) {
        sendJson(res, 400, { error: 'missing name parameter' });
        return;
      }
      const data = cache.dataCache.get(name);
      if (data === null) {
        sendJson(res, 404, { error: 'block not found in cache' });
        return;
      }
      const hashEntry = cache.hashCache.get(name);
      const resHeaders: Record<string, string | number> = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(data),
      };
      if (hashEntry) resHeaders['x-block-hash'] = hashEntry.hash;
      res.writeHead(200, resHeaders);
      res.end(data);
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

  // --- 그 외 → 투명 프록시 ---
  proxyRequest(req, res);
});

/** WebSocket upgrade */
server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);

  if (url.pathname === '/sync/ws') {
    const token = url.searchParams.get('token');
    if (token !== config.SYNC_TOKEN) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
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
  logger.info(`Token: ${config.SYNC_TOKEN.slice(0, 4)}****`);
  logger.info(`Max cache size: ${(config.MAX_CACHE_SIZE / 1048576).toFixed(0)}MB`);
  logger.info(`Max log entries: ${config.MAX_LOG_ENTRIES}`);
  logger.info(`Log level: ${config.LOG_LEVEL}`);
});
