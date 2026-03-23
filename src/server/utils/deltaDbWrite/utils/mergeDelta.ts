import { splitRawBlocks, RISUSAVE_MAGIC, type RawBlock } from './rawBlockSplitter';

/**
 * delta(변경 블록만) + cached(전체 binary) → 합성된 전체 binary.
 * cached body에서 블록을 추출, delta 블록으로 덮어쓴 뒤 재조립.
 *
 * null 반환 조건: cached 파싱 실패, delta 파싱 실패.
 */
export function mergeDelta(deltaBody: Buffer, cachedFullBody: Buffer): Buffer | null {
  const deltaBlocks = splitRawBlocks(deltaBody);
  const cachedBlocks = splitRawBlocks(cachedFullBody);

  if (!deltaBlocks || !cachedBlocks) return null;

  // cached blocks를 Map으로
  const blockMap = new Map<string, RawBlock>();
  for (const block of cachedBlocks) {
    blockMap.set(block.name, block);
  }

  // delta blocks로 덮어쓰기
  for (const block of deltaBlocks) {
    blockMap.set(block.name, block);
  }

  // 재조립: MAGIC + 모든 블록 raw bytes
  const parts: Buffer[] = [RISUSAVE_MAGIC];
  for (const block of blockMap.values()) {
    parts.push(block.raw);
  }

  return Buffer.concat(parts);
}
