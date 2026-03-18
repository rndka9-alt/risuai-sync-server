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

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    octets.push(n);
  }
  const [a, b] = octets;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // 127.0.0.0/8
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  return false;
}

/**
 * private/internal 네트워크 주소 여부를 판정.
 * SSRF 방어: 클라이언트가 지정한 URL이 내부 네트워크로 향하는 것을 차단.
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;

  // IPv6 loopback / unspecified
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 (unique local)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe80:')) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  return isPrivateIPv4(hostname);
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
