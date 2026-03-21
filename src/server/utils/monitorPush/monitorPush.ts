import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';

export function pushLlmEvent(event: Record<string, unknown>): void {
  if (!config.MONITOR_URL) return;

  const body = JSON.stringify(event);

  let url: URL;
  try {
    url = new URL('/_api/llm-event', config.MONITOR_URL);
  } catch {
    return;
  }

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      timeout: 3000,
    },
    (res) => {
      res.resume();
    },
  );

  req.on('error', (err) => {
    logger.debug('Monitor push failed', { error: err.message });
  });
  req.on('timeout', () => req.destroy());
  req.end(body);
}
