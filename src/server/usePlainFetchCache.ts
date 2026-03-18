import { parseRisuSaveBlocks } from './parser';
import * as cache from './cache';

/** usePlainFetch 캐시 — read tee 또는 write 경로에서 채워짐 */
let cachedUsePlainFetch: boolean | null = null;

export function extractUsePlainFetchFromBuffer(buffer: Buffer): void {
  const parsed = parseRisuSaveBlocks(buffer);
  if (!parsed) return;
  const rootBlock = parsed.blocks.get('root');
  if (!rootBlock) return;
  try {
    const root: Record<string, unknown> = JSON.parse(rootBlock.json);
    if (typeof root.usePlainFetch === 'boolean') {
      cachedUsePlainFetch = root.usePlainFetch;
    }
  } catch { /* ignore */ }
}

export function getUsePlainFetch(): boolean | null {
  if (cachedUsePlainFetch !== null) return cachedUsePlainFetch;
  // Fallback: write 경로에서 채워진 dataCache
  const rootData = cache.dataCache.get('root');
  if (rootData) {
    try {
      const parsed: Record<string, unknown> = JSON.parse(rootData);
      if (typeof parsed.usePlainFetch === 'boolean') {
        cachedUsePlainFetch = parsed.usePlainFetch;
        return cachedUsePlainFetch;
      }
    } catch { /* ignore */ }
  }
  return null;
}

/** 아직 추출이 필요한 상태인지 (read tee 판정용) */
export function needsExtraction(): boolean {
  return cachedUsePlainFetch === null;
}
