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
