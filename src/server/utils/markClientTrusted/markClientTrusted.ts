import { trustedClients } from '../../serverState';

/** WS 인증 성공 시 clientId를 grace period 신뢰 목록에 등록 */
export function markClientTrusted(clientId: string): void {
  trustedClients.set(clientId, Date.now());
}
