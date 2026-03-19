import { state } from './state';

/** 알림 UI */
export function showNotification(): void {
  if (state.notificationEl) {
    resetDismissTimer();
    return;
  }

  const el = document.createElement('div');
  el.id = 'risu-sync-notification';
  el.innerHTML =
    '<div style="' +
    'position:fixed;top:16px;left:16px;right:16px;' +
    'max-width:400px;margin:0 auto;box-sizing:border-box;' +
    'z-index:99999;background:#1e293b;border:1px solid #475569;' +
    'border-radius:8px;padding:12px 16px;display:flex;flex-wrap:wrap;' +
    'align-items:center;gap:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
    'color:#e2e8f0;font-size:14px;' +
    '">' +
    '<span style="flex:1 1 100%;">\ub2e4\ub978 \uae30\uae30\uc5d0\uc11c \ub370\uc774\ud130\uac00 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4.</span>' +
    '<div style="display:flex;gap:8px;margin-left:auto;">' +
    '<button id="risu-sync-reload" style="' +
    'background:#3b82f6;color:white;border:none;border-radius:4px;' +
    'padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;' +
    '">\uc0c8\ub85c\uace0\uce68</button>' +
    '<button id="risu-sync-dismiss" style="' +
    'background:transparent;color:#94a3b8;border:1px solid #475569;' +
    'border-radius:4px;padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;' +
    '">\ubb34\uc2dc</button>' +
    '</div></div>';

  state.notificationEl = el;
  document.body.appendChild(el);

  document.getElementById('risu-sync-reload')!.onclick = () => location.reload();
  document.getElementById('risu-sync-dismiss')!.onclick = () => hideNotification();

  resetDismissTimer();
}

export function hideNotification(): void {
  if (state.notificationEl) {
    state.notificationEl.remove();
    state.notificationEl = null;
  }
  if (state.dismissTimer) {
    clearTimeout(state.dismissTimer);
    state.dismissTimer = null;
  }
}

function resetDismissTimer(): void {
  if (state.dismissTimer) clearTimeout(state.dismissTimer);
  state.dismissTimer = setTimeout(hideNotification, 30000);
}

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
