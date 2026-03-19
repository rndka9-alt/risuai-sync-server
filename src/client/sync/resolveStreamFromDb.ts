import type { StreamState } from '../state';
import type { RisuDatabase } from './types';

export function resolveStreamFromDb(streamState: StreamState, db: RisuDatabase): boolean {
  if (streamState.resolved) return true;

  // Search for a character with isStreaming === true
  for (let ci = 0; ci < db.characters.length; ci++) {
    const char = db.characters[ci];
    const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
    if (!chats) continue;
    for (let chatIdx = 0; chatIdx < chats.length; chatIdx++) {
      const chat = chats[chatIdx];
      if (chat?.isStreaming === true && chat.message && chat.message.length > 0) {
        streamState.targetCharId = char.chaId;
        streamState.targetCharIndex = ci;
        streamState.targetChatIndex = chatIdx;
        streamState.targetMsgIndex = chat.message.length - 1;
        streamState.resolved = true;
        return true;
      }
    }
  }

  return false;
}
