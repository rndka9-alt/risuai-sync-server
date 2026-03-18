import type { MergeCharData } from '../types';
import { mergeChats } from './mergeChats';

/**
 * Merge 두 캐릭터 데이터.
 *
 * incoming을 base로 사용 (메타데이터는 유저의 로컬 편집 보존).
 * chats만 union merge한다.
 */
export function mergeCharData(
  serverData: MergeCharData,
  incomingData: MergeCharData,
): MergeCharData {
  const mergedChats = mergeChats(serverData.chats, incomingData.chats);

  // chatPage 범위 클램핑
  const chatPage = incomingData.chatPage >= 0 && incomingData.chatPage < mergedChats.length
    ? incomingData.chatPage
    : 0;

  return {
    ...incomingData,
    chats: mergedChats,
    chatPage,
  };
}
