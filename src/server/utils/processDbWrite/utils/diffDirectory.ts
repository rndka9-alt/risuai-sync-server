import * as logger from '../../../logger';

export interface DirDiffResult {
  added: string[];
  deleted: string[];
}

/**
 * ROOT 블록의 __directory(캐릭터 블록 목록) 변화를 감지.
 * incremental save에서는 캐릭터 데이터 블록이 바이너리에 포함되지 않으므로,
 * __directory 비교가 캐릭터 추가/삭제의 유일한 감지 수단.
 *
 * @param excludeBlocks 현재 바이너리에 포함된 블록 이름 (블록 루프에서 이미 처리됨 → 중복 방지)
 */
export function diffDirectory(
  oldRootJson: string | null,
  newRootJson: string,
  excludeBlocks: ReadonlySet<string>,
): DirDiffResult | null {
  if (!oldRootJson) return null;
  try {
    const oldDir = new Set<string>(JSON.parse(oldRootJson).__directory || []);
    const newDir: string[] = JSON.parse(newRootJson).__directory || [];
    const newDirSet = new Set(newDir);
    const added: string[] = [];
    const deleted: string[] = [];
    for (const entry of newDir) {
      if (!oldDir.has(entry) && !excludeBlocks.has(entry)) {
        added.push(entry);
      }
    }
    for (const entry of oldDir) {
      if (!newDirSet.has(entry)) {
        deleted.push(entry);
      }
    }
    if (added.length > 0 || deleted.length > 0) {
      logger.debug('diffDirectory', {
        oldDirSize: String(oldDir.size),
        newDirSize: String(newDir.length),
        added: JSON.stringify(added),
        deleted: JSON.stringify(deleted),
        oldDir: JSON.stringify([...oldDir]),
        newDir: JSON.stringify(newDir),
      });
    }
    return { added, deleted };
  } catch {
    return null;
  }
}
