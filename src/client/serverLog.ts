import { getToken } from './auth';
import { RISU_AUTH_HEADER } from './config';

/** fetch+keepalive로 서버에 로그 전송 (페이지 unload/reload 직전에도 안전) */
export function serverLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, string>,
): void {
  const token = getToken();
  if (!token) return;

  const body = JSON.stringify({ level, message, context });
  fetch('/sync/log', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [RISU_AUTH_HEADER]: token,
    },
    body,
    keepalive: true,
  }).catch(() => {});
}
