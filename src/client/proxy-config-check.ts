/**
 * Check /.proxy/config on init and show a toast if usePlainFetch is enabled.
 * Uses sessionStorage to ensure the toast is shown at most once per session.
 *
 * Shares the same SESSION_KEY as with-sqlite's client — whichever client
 * runs first handles the notification for both.
 */

const SESSION_KEY = 'risu-proxy-config-notified';

interface ProxyConfigEntry {
  usePlainFetch?: boolean | null;
  [key: string]: unknown;
}

interface ProxyConfig {
  withSqlite?: ProxyConfigEntry;
  sync?: ProxyConfigEntry;
  [key: string]: unknown;
}

function isProxyConfig(value: unknown): value is ProxyConfig {
  return typeof value === 'object' && value !== null;
}

export function checkProxyConfig(): void {
  if (sessionStorage.getItem(SESSION_KEY)) return;

  fetch('/.proxy/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: unknown) => {
      if (!isProxyConfig(raw)) return;

      const plainFetch =
        raw.withSqlite?.usePlainFetch === true ||
        raw.sync?.usePlainFetch === true;
      if (!plainFetch) return;

      const features: string[] = [];
      if (raw.withSqlite) features.push('스트리밍 복구');
      if (raw.sync) features.push('실시간 공유');

      if (features.length > 0) {
        sessionStorage.setItem(SESSION_KEY, '1');
        showToast(`직접 요청 모드 — ${features.join(', ')} 꺼짐`);
      }
    })
    .catch(() => {
      // Best-effort; never block normal operation
    });
}

function showToast(message: string): void {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:99999;' +
    'padding:12px 20px;border-radius:8px;font-size:14px;' +
    'background:#2c3e50;color:#ecf0f1;cursor:pointer;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3);max-width:360px;' +
    'word-break:break-word;transition:opacity 0.3s;';
  el.addEventListener('click', () => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}
