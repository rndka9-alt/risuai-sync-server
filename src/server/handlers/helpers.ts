import http from 'http';
import type { ServerMessage } from '../../shared/types';
import { clients } from '../serverState';
import * as config from '../config';
import * as logger from '../logger';

export function sendJson(res: http.ServerResponse, statusCode: number, data: object): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Write 실패 시 WebSocket으로 sender에게 알림 */
export function notifyWriteFailed(senderClientId: string | null, path: string, attempts: number): void {
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
export function sendUpstreamWithRetry(
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

export function proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
