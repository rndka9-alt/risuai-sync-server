import type { StreamState } from '../../state';
import type { PluginApis } from '../types';

declare var __pluginApis__: PluginApis | undefined;

/** isStreaming 해제 + reloadKeys 증가 */
export function finalizeStream(streamState: StreamState): void {
  if (!streamState.resolved || typeof __pluginApis__ === 'undefined') return;
  try {
    const db = __pluginApis__.getDatabase();
    const char = db.characters?.[streamState.targetCharIndex];
    if (!char) return;
    const chats = (char as Record<string, unknown>).chats as Array<{ isStreaming?: boolean }> | undefined;
    const chat = chats?.[streamState.targetChatIndex];
    if (chat) {
      chat.isStreaming = false;
    }
    (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
  } catch {
    // Non-fatal
  }
}
