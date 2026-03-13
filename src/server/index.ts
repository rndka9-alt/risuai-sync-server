import http from 'http';
import crypto from 'crypto';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import * as config from './config';
import * as cache from './cache';
import * as sync from './sync';
import { buildClientJs } from './client-bundle';
import type { ClientMessage, HealthResponse } from '../shared/types';

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const clients = new Map<string, WebSocket>();
const aliveState = new WeakMap<WebSocket, boolean>();
const wss = new WebSocketServer({ noServer: true });

sync.init(clients);

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId') || crypto.randomBytes(8).toString('hex');

  clients.set(clientId, ws);
  aliveState.set(ws, true);
  console.log(`[Sync] Client connected: ${clientId} (total: ${clients.size})`);

  ws.on('pong', () => { aliveState.set(ws, true); });

  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg: ClientMessage = JSON.parse(raw.toString());
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
    clients.delete(clientId);
    console.log(`[Sync] Client disconnected: ${clientId} (total: ${clients.size})`);
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

// ---------------------------------------------------------------------------
// HTTP 유틸
// ---------------------------------------------------------------------------
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
              console.error('[Sync] Error processing DB write:', e);
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

// ---------------------------------------------------------------------------
// HTTP 서버
// ---------------------------------------------------------------------------
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
      const headers: Record<string, string | number> = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(data),
      };
      if (hashEntry) headers['x-block-hash'] = hashEntry.hash;
      res.writeHead(200, headers);
      res.end(data);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sync/changes') {
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      const result = cache.getChangesSince(since);
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

          const headers = { ...proxyRes.headers };
          headers['content-length'] = String(Buffer.byteLength(html));
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];

          res.writeHead(proxyRes.statusCode!, headers);
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

  // --- 그 외 → 투명 프록시 ---
  proxyRequest(req, res);
});

// ---------------------------------------------------------------------------
// WebSocket upgrade
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 서버 시작
// ---------------------------------------------------------------------------
server.listen(config.PORT, () => {
  console.log(`[Sync] Server listening on port ${config.PORT}`);
  console.log(`[Sync] Upstream: ${config.UPSTREAM.href}`);
  console.log(`[Sync] DB path: ${config.DB_PATH}`);
  console.log(`[Sync] Token: ${config.SYNC_TOKEN.slice(0, 4)}****`);
  console.log(`[Sync] Max cache size: ${(config.MAX_CACHE_SIZE / 1048576).toFixed(0)}MB`);
  console.log(`[Sync] Max log entries: ${config.MAX_LOG_ENTRIES}`);
});
