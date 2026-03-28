import { getToken } from './auth';
import { CLIENT_ID, CLIENT_ID_HEADER, RISU_AUTH_HEADER } from './config';

/** fetch+keepalive로 서버에 로그 전송 (페이지 unload/reload 직전에도 안전) */
export function serverLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, string>,
): void {
  const token = getToken();

  const body = JSON.stringify({ level, message, context });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [CLIENT_ID_HEADER]: CLIENT_ID,
  };
  if (token) {
    headers[RISU_AUTH_HEADER] = token;
  }
  fetch('/sync/log', {
    method: 'POST',
    headers,
    body,
    keepalive: true,
  }).catch((e) => { console.warn('[sync] serverLog send failed', e); });
}
