/** 데이터 저장 실패 알림 */
export function showWriteFailedNotification(): void {
  const existingId = 'risu-sync-write-failed';
  const existing = document.getElementById(existingId);
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = existingId;
  el.innerHTML =
    '<div style="' +
    'position:fixed;top:16px;left:16px;right:16px;' +
    'max-width:400px;margin:0 auto;box-sizing:border-box;' +
    'z-index:99999;background:#7f1d1d;border:1px solid #dc2626;' +
    'border-radius:8px;padding:12px 16px;display:flex;flex-wrap:wrap;' +
    'align-items:center;gap:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'color:#fecaca;font-size:14px;' +
    '">' +
    '<span style="flex:1 1 100%;">\ub370\uc774\ud130 \uc800\uc7a5\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4. \ub124\ud2b8\uc6cc\ud06c \uc5f0\uacb0\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.</span>' +
    '<button id="risu-sync-write-failed-dismiss" style="' +
    'background:transparent;color:#fca5a5;border:1px solid #dc2626;' +
    'border-radius:4px;padding:6px 12px;cursor:pointer;font-size:13px;' +
    'white-space:nowrap;margin-left:auto;' +
    '">\ud655\uc778</button>' +
    '</div>';

  document.body.appendChild(el);

  const dismissBtn = document.getElementById('risu-sync-write-failed-dismiss');
  if (dismissBtn) dismissBtn.onclick = () => el.remove();

  setTimeout(() => {
    if (el.parentNode) el.remove();
  }, 15000);
}
