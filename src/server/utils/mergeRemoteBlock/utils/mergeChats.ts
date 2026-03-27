import type { MergeChat, MergeMessage } from '../types';
import { mergeMessages } from './mergeMessages';

/**
 * Chat fingerprint: id 없는 chat의 fallback 매칭용.
 * name + 첫 메시지의 role + content prefix로 구성.
 */
function chatFingerprint(chat: MergeChat): string {
  const firstMsg: MergeMessage | undefined = chat.message[0];
  if (!firstMsg) return `name:${chat.name}:empty`;
  const prefix = (firstMsg.data || '').slice(0, 100);
  return `name:${chat.name}:${firstMsg.role}:${prefix}`;
}

/**
 * Union-merge 두 Chat 배열.
 *
 * 전략:
 * 1. chat.id로 매칭 (존재 시)
 * 2. id 없는 chats: fingerprint로 fuzzy 매칭
 * 3. 매칭된 chats: mergeMessages로 메시지 merge
 * 4. server에만 있는 chats: 추가 (stale 디바이스가 못 받은 것)
 * 5. incoming에만 있는 chats: 추가 (오프라인에서 생성한 것)
 *
 * 매칭된 chat의 메타데이터(name 등)는 incoming 기준 (유저 로컬 편집 보존).
 */
export function mergeChats(
  serverChats: MergeChat[],
  incomingChats: MergeChat[],
): MergeChat[] {
  if (serverChats.length === 0) return [...incomingChats];
  if (incomingChats.length === 0) return [...serverChats];

  // server chats를 id로 인덱싱
  const serverById = new Map<string, number>();
  for (let i = 0; i < serverChats.length; i++) {
    if (serverChats[i].id) {
      serverById.set(serverChats[i].id!, i);
    }
  }

  // server chats를 fingerprint로 인덱싱 (id 없는 것만)
  const serverByFp = new Map<string, number>();
  for (let i = 0; i < serverChats.length; i++) {
    if (!serverChats[i].id) {
      serverByFp.set(chatFingerprint(serverChats[i]), i);
    }
  }

  const matchedServerIndices = new Set<number>();
  const result: MergeChat[] = [];

  // incoming chats 순회: 매칭 시도
  for (const inChat of incomingChats) {
    let serverIdx: number | undefined;

    // 1차: id 매칭
    if (inChat.id && serverById.has(inChat.id)) {
      serverIdx = serverById.get(inChat.id);
    }

    // 2차: fingerprint 매칭
    if (serverIdx === undefined && !inChat.id) {
      const fp = chatFingerprint(inChat);
      if (serverByFp.has(fp)) {
        serverIdx = serverByFp.get(fp);
      }
    }

    if (serverIdx !== undefined && !matchedServerIndices.has(serverIdx)) {
      // 매칭됨: 메시지 merge
      matchedServerIndices.add(serverIdx);
      const mergedMessages = mergeMessages(serverChats[serverIdx].message, inChat.message);
      // server를 base로 깔아 note 등 기존 필드를 보존하고, incoming으로 덮어써서 유저 편집 반영
      result.push({ ...serverChats[serverIdx], ...inChat, message: mergedMessages });
    } else {
      // incoming에만 있는 chat: 그대로 추가
      result.push({ ...inChat });
    }
  }

  // server에만 있는 chats: 결과에 추가 (stale 디바이스가 못 받은 것)
  for (let i = 0; i < serverChats.length; i++) {
    if (!matchedServerIndices.has(i)) {
      result.push({ ...serverChats[i] });
    }
  }

  return result;
}
