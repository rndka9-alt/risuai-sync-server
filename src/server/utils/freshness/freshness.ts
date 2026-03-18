import { clients, freshClients } from '../../serverState';

/** 클라이언트가 catch-up을 완료한 "fresh" 상태인지 확인 */
export function isClientFresh(clientId: string | null): boolean {
  if (!clientId) return false;
  if (!clients.has(clientId)) return false;
  return freshClients.has(clientId);
}
