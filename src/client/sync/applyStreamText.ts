import type { StreamState } from '../state';
import type { RisuDatabase } from './types';

export function applyStreamText(streamState: StreamState, db: RisuDatabase): void {
  const char = db.characters[streamState.targetCharIndex];
  if (!char) return;
  const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
  const chat = chats?.[streamState.targetChatIndex];
  if (!chat?.message) return;

  if (streamState.targetMsgIndex >= 0 && streamState.targetMsgIndex < chat.message.length) {
    chat.message[streamState.targetMsgIndex].data = streamState.lastText;
  }

  (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
}
