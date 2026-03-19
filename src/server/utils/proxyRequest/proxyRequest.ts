import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';

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
