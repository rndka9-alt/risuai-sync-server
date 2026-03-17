import http from 'http';
import https from 'https';
import * as logger from './logger';

export interface DecodedProxy2 {
  targetUrl: URL;
  headers: Record<string, string>;
}

/**
 * proxy2 요청에서 risu-url, risu-header를 디코딩.
 * risu-url이 없거나 파싱 실패 시 null 반환 → upstream fallback.
 */
export function decodeProxy2Headers(req: http.IncomingMessage): DecodedProxy2 | null {
  const rawUrl = req.headers['risu-url'];
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;

  let targetUrl: URL;
  try {
    targetUrl = new URL(decodeURIComponent(rawUrl));
  } catch {
    logger.warn('Invalid risu-url', { rawUrl });
    return null;
  }

  const headers: Record<string, string> = {};
  const rawHeader = req.headers['risu-header'];
  if (typeof rawHeader === 'string' && rawHeader.length > 0) {
    try {
      const parsed = JSON.parse(decodeURIComponent(rawHeader));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record: { [key: string]: unknown } = parsed;
        for (const [k, v] of Object.entries(record)) {
          if (typeof v === 'string') {
            headers[k] = v;
          }
        }
      }
    } catch {
      logger.warn('Invalid risu-header JSON');
      return null;
    }
  }

  return { targetUrl, headers };
}

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
