import { CLIENT_ID, CLIENT_ID_HEADER, PROXY2_TARGET_HEADER } from '../../config';
import { extractHeader } from '../../utils/extractHeader';
import { setHeader } from './setHeader';
import { findStreamTarget } from './findStreamTarget';

/**
 * 직접 LLM 요청을 /proxy2 포맷으로 변환한다.
 * risu-url, risu-header 헤더를 구성하고 sync 헤더를 추가한다.
 */
export function buildProxy2Request(
  originalUrl: string,
  originalInit: RequestInit,
  cleanBody: string,
): RequestInit {
  const originalHeaders: Record<string, string> = {};
  if (originalInit.headers) {
    if (originalInit.headers instanceof Headers) {
      originalInit.headers.forEach((value, key) => {
        originalHeaders[key] = value;
      });
    } else if (Array.isArray(originalInit.headers)) {
      for (const [key, value] of originalInit.headers) {
        originalHeaders[key] = value;
      }
    } else {
      Object.assign(originalHeaders, originalInit.headers);
    }
  }

  const headers: Record<string, string> = {
    'risu-url': encodeURIComponent(originalUrl),
    'risu-header': encodeURIComponent(JSON.stringify(originalHeaders)),
    'Content-Type': 'application/json',
    [CLIENT_ID_HEADER]: CLIENT_ID,
  };

  const target = findStreamTarget();
  if (target) {
    headers[PROXY2_TARGET_HEADER] = target;
  }

  return {
    method: 'POST',
    headers,
    body: cleanBody,
    signal: originalInit.signal,
  };
}
