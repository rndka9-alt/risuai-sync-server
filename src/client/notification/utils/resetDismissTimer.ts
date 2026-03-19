import { state } from '../../state';
import { hideNotification } from '../hideNotification';

export function resetDismissTimer(): void {
  if (state.dismissTimer) clearTimeout(state.dismissTimer);
  state.dismissTimer = setTimeout(hideNotification, 30000);
}
