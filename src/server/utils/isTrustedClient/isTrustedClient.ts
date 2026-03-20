import { trustedClients, TRUST_GRACE_PERIOD_MS } from '../../serverState';

/** clientId가 grace period 내에 인증된 적이 있는지 확인 */
export function isTrustedClient(clientId: string | null): boolean {
  if (!clientId) return false;
  const authedAt = trustedClients.get(clientId);
  if (authedAt === undefined) return false;
  if (Date.now() - authedAt > TRUST_GRACE_PERIOD_MS) {
    trustedClients.delete(clientId);
    return false;
  }
  return true;
}
