import * as cache from '../../cache';
import * as logger from '../../logger';
import { mergeCharData } from './utils/mergeCharData';
import type { MergeCharData } from './types';

function hasChatsArray(data: unknown): data is MergeCharData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.chats) && typeof obj.chatPage === 'number';
}

/**
 * Stale 클라이언트의 remote block write를 서버 캐시와 union merge.
 *
 * 캐시된 데이터가 없거나, 파싱 실패 시 null 반환 (pass-through).
 * 에러 발생 시에도 null 반환하여 원래 write가 그대로 진행되도록 보장 (fail-safe).
 */
export function mergeRemoteBlock(
  charId: string,
  incomingBuffer: Buffer,
): Buffer | null {
  try {
    const cachedJson = cache.dataCache.get(charId);
    if (!cachedJson) return null;

    const incomingJson = incomingBuffer.toString('utf-8');

    let serverData: unknown;
    let incomingData: unknown;
    try {
      serverData = JSON.parse(cachedJson);
    } catch {
      logger.warn('Merge: cached data is not valid JSON', { charId });
      return null;
    }
    try {
      incomingData = JSON.parse(incomingJson);
    } catch {
      logger.warn('Merge: incoming data is not valid JSON', { charId });
      return null;
    }

    if (!hasChatsArray(serverData) || !hasChatsArray(incomingData)) {
      return null;
    }

    const merged = mergeCharData(serverData, incomingData);
    const mergedJson = JSON.stringify(merged);

    // merge 전후 동일하면 불필요한 재인코딩 방지
    if (mergedJson === incomingJson) return null;

    logger.info('Stale client merge applied', {
      charId,
      serverChats: String(serverData.chats.length),
      incomingChats: String(incomingData.chats.length),
      mergedChats: String(merged.chats.length),
    });

    return Buffer.from(mergedJson, 'utf-8');
  } catch (e) {
    logger.error('Merge failed (pass-through)', {
      charId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
