import { isSyncedRootKey } from '../../shared/blockTypes';
import type { BlockChange } from '../../shared/types';

/**
 * ROOT 블록이 live-apply 가능한지 확인.
 * changedKeys가 모두 SYNCED이고 unknown 키 없음 → safe
 */
export function isRootSafeChange(block: BlockChange): boolean {
  if (!block.changedKeys || !Array.isArray(block.changedKeys)) return false;
  if (block.changedKeys.length === 0) return false;
  if (block.hasUnknownKeys) return false;
  return block.changedKeys.every(isSyncedRootKey);
}
