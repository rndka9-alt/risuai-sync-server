/** Sync 연결 실패 시 직접 스트리밍 fallback 토스트 (5초 후 자동 사라짐) */
export function showSyncFallbackNotice(): void {
  const el = document.createElement('div');
  el.textContent = 'Sync 연결 실패 — 스트리밍을 직접 요청합니다';
  el.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:99999;' +
    'padding:12px 20px;border-radius:8px;font-size:14px;' +
    'background:#7f1d1d;color:#fca5a5;cursor:pointer;' +
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
