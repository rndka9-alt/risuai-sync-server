import { BLOCK_TYPE } from '../../shared/blockTypes';
import type { BlockChange } from '../../shared/types';
import { PLUGIN_WRITABLE_KEYS } from './types';
import { isRootSafeChange } from './isRootSafeChange';

/** changed 블록을 캐릭터/safeRoot/reload로 분류 */
export function classifyChangedBlocks(changed: BlockChange[]): {
  charBlocks: BlockChange[];
  safeRootBlocks: BlockChange[];
  needsReload: boolean;
} {
  const charBlocks = changed
    .filter((b) => b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT);

  const safeRootBlocks: BlockChange[] = [];
  let needsReload = false;

  changed.forEach((b) => {
    if (b.type === BLOCK_TYPE.CONFIG || b.type === BLOCK_TYPE.BOTPRESET || b.type === BLOCK_TYPE.MODULES) return;
    if (b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT) return;
    if (b.type === BLOCK_TYPE.ROOT && isRootSafeChange(b)) {
      if (b.changedKeys!.every((k) => PLUGIN_WRITABLE_KEYS.has(k))) {
        safeRootBlocks.push(b);
      } else {
        needsReload = true;
      }
      return;
    }
    // 그 외 (unsafe ROOT 등) → reload
    needsReload = true;
  });

  return { charBlocks, safeRootBlocks, needsReload };
}
