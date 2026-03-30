import type { MergeMessage } from '../types';

/**
 * 메시지 fingerprint: chatId 없는 메시지의 fallback 매칭용.
 * position + role + content prefix로 구성.
 */
function messageFingerprint(msg: MergeMessage, index: number): string {
  const prefix = (msg.data || '').slice(0, 100);
  return `${index}:${msg.role}:${prefix}`;
}

/**
 * Union-merge 두 메시지 배열.
 *
 * 전략:
 * - server 메시지를 기준으로 시작 (authoritative)
 * - incoming에서 server에 없는 메시지만 추가
 * - chatId 있으면 chatId로 매칭, 없으면 fingerprint로 매칭
 * - 결과: server 메시지 전체 + incoming에서 새로 발견된 메시지
 */
export function mergeMessages(
  serverMsgs: MergeMessage[],
  incomingMsgs: MergeMessage[],
): MergeMessage[] {
  if (serverMsgs.length === 0) return [...incomingMsgs];
  if (incomingMsgs.length === 0) return [...serverMsgs];

  // server 메시지의 chatId set
  const serverChatIds = new Set<string>();
  for (const msg of serverMsgs) {
    if (msg.chatId) {
      serverChatIds.add(msg.chatId);
    }
  }

  // server 메시지의 fingerprint set (chatId 없는 메시지용)
  const serverFingerprints = new Set<string>();
  for (let i = 0; i < serverMsgs.length; i++) {
    if (!serverMsgs[i].chatId) {
      serverFingerprints.add(messageFingerprint(serverMsgs[i], i));
    }
  }

  // incoming에서 server에 없는 메시지 수집
  const newMessages: MergeMessage[] = [];
  for (let i = 0; i < incomingMsgs.length; i++) {
    const msg = incomingMsgs[i];
    if (msg.chatId) {
      if (!serverChatIds.has(msg.chatId)) {
        newMessages.push(msg);
      }
    } else {
      const fp = messageFingerprint(msg, i);
      if (!serverFingerprints.has(fp)) {
        newMessages.push(msg);
      }
    }
  }

  if (newMessages.length === 0) return [...serverMsgs];

  // time 기반 삽입: time이 있으면 적절한 위치에, 없으면 끝에 append
  const result = [...serverMsgs];
  const withTime: MergeMessage[] = [];
  const withoutTime: MergeMessage[] = [];

  for (const msg of newMessages) {
    if (msg.time != null && msg.time > 0) {
      withTime.push(msg);
    } else {
      withoutTime.push(msg);
    }
  }

  // time 있는 메시지: 적절한 위치에 삽입
  for (const msg of withTime) {
    let insertIdx = result.length;
    for (let i = 0; i < result.length; i++) {
      if (result[i].time != null && result[i].time! > msg.time!) {
        insertIdx = i;
        break;
      }
    }
    result.splice(insertIdx, 0, msg);
  }

  // time 없는 메시지: 끝에 추가
  result.push(...withoutTime);

  return result;
}
