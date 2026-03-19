import type { ServerMessage } from '../../../shared/types';
import { clients } from '../../serverState';

/** Write 실패 시 WebSocket으로 sender에게 알림 */
export function notifyWriteFailed(senderClientId: string | null, path: string, attempts: number): void {
  if (!senderClientId) return;
  const ws = clients.get(senderClientId);
  if (!ws || ws.readyState !== 1) return;
  const msg: ServerMessage = {
    type: 'write-failed',
    path,
    attempts,
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(msg));
}
