import { computeSha256Hex } from './utils/computeSha256Hex';

/** charId → SHA-256 hex hash */
const remoteBlockHashCache = new Map<string, string>();

/**
 * 이전에 전송한 body와 동일한지 SHA-256 해시로 비교.
 * 동일하면 true (스킵 가능), 다르면 false (전송 필요) + 캐시 갱신.
 */
export async function isUnchangedRemoteBlock(charId: string, body: Uint8Array): Promise<boolean> {
  const hash = await computeSha256Hex(body);
  if (remoteBlockHashCache.get(charId) === hash) return true;
  remoteBlockHashCache.set(charId, hash);
  return false;
}
