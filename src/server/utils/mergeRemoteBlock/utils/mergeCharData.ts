import type { MergeCharData } from '../types';
import { mergeChats } from './mergeChats';

/**
 * Merge 두 캐릭터 데이터.
 *
 * server를 base로 깔아 기존 필드를 보존하고,
 * incoming을 덮어써서 유저의 로컬 편집을 반영한다.
 * chats는 union merge 결과로 교체.
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
    ...serverData,
    ...incomingData,
    chats: mergedChats,
    chatPage,
  };
}
