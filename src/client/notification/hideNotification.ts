import { state } from '../state';

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
