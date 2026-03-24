import http from 'http';
import * as logger from '../../logger';
import type { DecodedProxy2 } from './types';

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

  const rawMethod = req.headers['x-proxy-method'];
  const method = typeof rawMethod === 'string' && rawMethod.length > 0
    ? rawMethod
    : 'POST';

  if (!rawMethod) {
    logger.warn('x-proxy-method header missing, falling back to POST (RisuAI core client)');
  }

  return { targetUrl, headers, method };
}
