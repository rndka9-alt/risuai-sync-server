import * as cache from '../../cache';
import { clientRootCache, clientDisconnectedAt } from '../../serverState';

export function removeClientCache(clientId: string): void {
  clientDisconnectedAt.set(clientId, Date.now());
}

/** WS init 메시지 수신 시: per-client ROOT 캐시 초기화.
 * 최초 접속: 글로벌 ROOT에서 복사 (클라이언트가 방금 로딩한 DB와 일치).
 * 재연결: 기존 엔트리 보존 (sender의 실제 DB 상태를 유지하여 false delete 방지).
 */
export function initClientRootCache(clientId: string): void {
  clientDisconnectedAt.delete(clientId);
  if (clientRootCache.has(clientId)) return;
  const rootJson = cache.dataCache.get('root');
  if (rootJson) {
    clientRootCache.set(clientId, rootJson);
  }
}
