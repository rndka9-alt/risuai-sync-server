import type { ServerMessage } from '../../../shared/types';
import { clients } from '../../serverState';

export function broadcast(payload: ServerMessage, excludeClientId: string | null): void {
  const data = JSON.stringify(payload);
  for (const [id, client] of clients) {
    if (id !== excludeClientId && client.readyState === 1) {
      client.send(data);
    }
  }
}
