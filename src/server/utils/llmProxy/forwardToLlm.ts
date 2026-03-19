import http from 'http';
import https from 'https';
import type { DecodedProxy2 } from './types';

/**
 * 디코딩된 LLM API URL로 직접 요청 전송.
 * SSE 스트리밍 응답은 onResponse 콜백에서 처리.
 */
export function forwardToLlm(
  decoded: DecodedProxy2,
  body: Buffer,
  onResponse: (proxyRes: http.IncomingMessage) => void,
  onError: (err: Error) => void,
): http.ClientRequest {
  const isHttps = decoded.targetUrl.protocol === 'https:';
  const requestFn = isHttps ? https.request : http.request;
  const defaultPort = isHttps ? 443 : 80;

  const headers: Record<string, string> = { ...decoded.headers };
  headers['content-length'] = String(body.length);
  headers['host'] = decoded.targetUrl.host;

  const proxyReq = requestFn(
    {
      hostname: decoded.targetUrl.hostname,
      port: decoded.targetUrl.port || defaultPort,
      path: decoded.targetUrl.pathname + decoded.targetUrl.search,
      method: 'POST',
      headers,
    },
    (proxyRes) => {
      // Strip security/caching headers (Node 서버 동작 일치)
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['clear-site-data'];
      delete proxyRes.headers['cache-control'];
      delete proxyRes.headers['content-encoding'];

      onResponse(proxyRes);
    },
  );

  proxyReq.on('error', onError);
  proxyReq.end(body);

  return proxyReq;
}
