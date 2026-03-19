import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';

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
