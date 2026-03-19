import type { StreamState } from '../state';
import type { RisuCharacter, RisuDatabase } from './types';

/** Stream sync: resolveStreamTarget — DB 내 캐릭터에서 스트림 대상을 찾아 resolve */
export function resolveStreamTarget(streamState: StreamState, db: RisuDatabase): boolean {
  if (streamState.resolved) return true;
  if (!streamState.targetCharId) return false;

  const charIndex = db.characters.findIndex(
    (c: RisuCharacter) => c && c.chaId === streamState.targetCharId,
  );
  if (charIndex === -1) return false;

  const char = db.characters[charIndex];
  const chatPage = (char as Record<string, unknown>).chatPage as number ?? 0;
  const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
  const chat = chats?.[chatPage];
  if (!chat || !chat.message) return false;

  streamState.targetCharIndex = charIndex;
  streamState.targetChatIndex = chatPage;

  // Find or create the AI response message
  const messages = chat.message;
  const lastMsg = messages[messages.length - 1];

  if (lastMsg && lastMsg.role === 'char') {
    streamState.targetMsgIndex = messages.length - 1;
  } else {
    // Create placeholder AI message
    messages.push({
      role: 'char',
      data: '',
      saying: streamState.targetCharId,
      time: Date.now(),
    });
    streamState.targetMsgIndex = messages.length - 1;
  }

  chat.isStreaming = true;
  streamState.resolved = true;
  (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
  return true;
}
