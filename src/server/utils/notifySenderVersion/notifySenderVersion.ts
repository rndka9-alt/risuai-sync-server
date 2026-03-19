import * as cache from '../../cache';
import { clients } from '../../serverState';
import type { ServerMessage } from '../../../shared/types';

/** sender에게 version-update만 알림 (catch-up 시 자기 변경분을 다시 받지 않도록) */
export function notifySenderVersion(senderClientId: string | null, version: number): void {
  if (senderClientId && clients.has(senderClientId)) {
    const senderWs = clients.get(senderClientId)!;
    if (senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'version-update', epoch: cache.epoch, version } satisfies ServerMessage));
    }
  }
}
