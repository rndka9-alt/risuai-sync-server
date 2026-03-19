const PLAIN_FETCH_SESSION_KEY = 'risu-proxy-config-notified';

/** 직접 요청 모드 경고 (세션당 1회) */
export function showPlainFetchWarning(): void {
  if (sessionStorage.getItem(PLAIN_FETCH_SESSION_KEY)) return;
  sessionStorage.setItem(PLAIN_FETCH_SESSION_KEY, '1');

  const el = document.createElement('div');
  el.textContent = '직접 요청 모드 켜짐';
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
