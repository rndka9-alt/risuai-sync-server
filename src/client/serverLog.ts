import { SYNC_TOKEN } from './config';

/** sendBeacon으로 서버에 로그 전송 (페이지 unload/reload 직전에도 안전) */
export function serverLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, string>,
): void {
  const body = JSON.stringify({ level, message, context });
  const blob = new Blob([body], { type: 'application/json' });
  navigator.sendBeacon('/sync/log?token=' + encodeURIComponent(SYNC_TOKEN), blob);
}
