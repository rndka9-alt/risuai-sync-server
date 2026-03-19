interface RisuCharacterLike {
  chaId: string;
  chatPage?: number;
  chats?: Array<{ message?: Array<{ time?: number; [key: string]: unknown }> }>;
}

interface RisuDatabaseLike {
  characters: RisuCharacterLike[];
}

interface PluginApisLike {
  getDatabase(): RisuDatabaseLike;
}

declare var __pluginApis__: PluginApisLike | undefined;

/**
 * Find the chaId of the character with the most recent message.
 * At proxy2 fetch time, the user's message has already been added
 * but the AI response hasn't been created yet.
 */
export function findStreamTarget(): string | null {
  try {
    if (typeof __pluginApis__ === 'undefined') return null;
    const db = __pluginApis__.getDatabase();
    if (!db?.characters) return null;

    let bestCharId: string | null = null;
    let bestTime = 0;

    for (const char of db.characters) {
      if (!char?.chats) continue;
      const chatPage = char.chatPage ?? 0;
      const chat = char.chats[chatPage];
      if (!chat?.message || chat.message.length === 0) continue;
      const lastMsg = chat.message[chat.message.length - 1];
      const msgTime = lastMsg.time || 0;
      if (msgTime > bestTime) {
        bestTime = msgTime;
        bestCharId = char.chaId;
      }
    }

    return bestCharId;
  } catch {
    return null;
  }
}
