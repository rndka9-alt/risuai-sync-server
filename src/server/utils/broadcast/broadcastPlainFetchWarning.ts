import type { PlainFetchWarningMessage } from '../../../shared/types';
import { broadcast } from './broadcast';

/** usePlainFetch 감지 시 전체 클라이언트에게 경고 */
export function broadcastPlainFetchWarning(): void {
  const msg: PlainFetchWarningMessage = {
    type: 'plain-fetch-warning',
    timestamp: Date.now(),
  };
  broadcast(msg, null);
}
