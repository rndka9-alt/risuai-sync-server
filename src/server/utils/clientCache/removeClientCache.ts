import { clientDisconnectedAt } from '../../serverState';

export function removeClientCache(clientId: string): void {
  clientDisconnectedAt.set(clientId, Date.now());
}
