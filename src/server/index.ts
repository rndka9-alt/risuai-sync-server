import http from 'http';
import crypto from 'crypto';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import * as config from './config';
import * as cache from './cache';
import * as sync from './sync';
import { buildClientJs } from './client-bundle';
import type { ClientMessage, HealthResponse } from '../shared/types';
import * as logger from './logger';

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

function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const proxyReq = http.request(
    {
      hostname: config.UPSTREAM.hostname,
      port: config.UPSTREAM.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: config.UPSTREAM.host },
    },
    (proxyRes) => {
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
  const rawClientId = req.headers['x-sync-client-id'];
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

    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: config.UPSTREAM.host };
    delete headers['x-sync-client-id'];

    const proxyReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);

        if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300) {
          setImmediate(() => {
            try {
              sync.processDbWrite(buffer, senderClientId);
            } catch (e) {
              logger.error('Error processing DB write', { error: e instanceof Error ? e.message : String(e) });
              sync.broadcastDbChanged(senderClientId);
            }
          });
        }
      },
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('Bad Gateway');
    });

    proxyReq.write(buffer);
    proxyReq.end();
  });
}

/** Remote block write 프록시 (Node 서버 모드: remotes/{charId}.local.bin) */
function proxyRemoteBlockWrite(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers['x-sync-client-id'];
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

    const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: config.UPSTREAM.host };
    delete headers['x-sync-client-id'];

    const proxyReq = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);

        if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300 && charId) {
          setImmediate(() => {
            try {
              sync.processRemoteBlockWrite(buffer, charId, senderClientId);
            } catch (e) {
              logger.error('Error processing remote block write', { error: e instanceof Error ? e.message : String(e) });
              sync.broadcastDbChanged(senderClientId);
            }
          });
        }
      },
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('Bad Gateway');
    });

    proxyReq.write(buffer);
    proxyReq.end();
  });
}

/** proxy2 스트리밍 프록시 */
function isProxy2Post(req: http.IncomingMessage): boolean {
  return req.method === 'POST' && (req.url === '/proxy2' || req.url?.startsWith('/proxy2?') === true);
}

function proxyProxy2(req: http.IncomingMessage, res: http.ServerResponse): void {
  const rawClientId = req.headers['x-sync-client-id'];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : 'unknown';
  const rawTargetCharId = req.headers['x-sync-proxy2-target-char'];
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

  // Strip sync headers before forwarding to upstream
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: config.UPSTREAM.host,
  };
  delete headers['x-sync-client-id'];
  delete headers['x-sync-proxy2-target-char'];

  const proxyReq = http.request(
    {
      hostname: config.UPSTREAM.hostname,
      port: config.UPSTREAM.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isSSE = contentType.includes('text/event-stream');

      if (!isSSE) {
        // Non-streaming: pass through normally
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);
        return;
      }

      // SSE streaming response — tee it
      const streamId = crypto.randomBytes(8).toString('hex');
      logger.info('Stream started', { streamId, sender: senderClientId, targetCharId: targetCharId || 'unknown' });

      sync.createStream(streamId, senderClientId, targetCharId);

      res.writeHead(proxyRes.statusCode!, proxyRes.headers);

      proxyRes.on('data', (chunk: Buffer) => {
        res.write(chunk);
        sync.processStreamChunk(streamId, chunk);
      });

      proxyRes.on('end', () => {
        logger.info('Stream ended', { streamId });
        sync.endStream(streamId);
        res.end();
      });

      proxyRes.on('error', (err) => {
        logger.error('Stream error', { streamId, error: err.message });
        sync.endStream(streamId);
        if (!res.writableEnded) res.end();
      });
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

/** HTTP 서버 */
const server = http.createServer((req, res) => {
  // --- /sync/* 경로 ---
  if (req.url!.startsWith('/sync/')) {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/sync/client.js') {
      const js = buildClientJs();
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'content-length': Buffer.byteLength(js),
        'cache-control': 'no-cache',
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
      sendJson(res, result.status, result.data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sync/manifest') {
      sendJson(res, 200, cache.getManifest());
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
          html = html.replace('</head>', config.SCRIPT_TAG + '</head>');

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
