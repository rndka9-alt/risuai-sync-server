import { DB_PATH, CLIENT_ID } from './config';

// ---------------------------------------------------------------------------
// fetch monkey-patch
// ---------------------------------------------------------------------------
const originalFetch = window.fetch;

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

function hexToStr(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return s;
}

function getHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return pair ? pair[1] : null;
  }
  // TS narrowing: Headers, string[][] 제거 → Record<string, string>
  return headers[name] || null;
}

function setHeader(headers: HeadersInit, name: string, value: string): void {
  if (headers instanceof Headers) {
    headers.set(name, value);
  } else if (Array.isArray(headers)) {
    headers.push([name, value]);
  } else {
    headers[name] = value;
  }
}

/**
 * Find the chaId of the character with the most recent message.
 * At proxy2 fetch time, the user's message has already been added
 * but the AI response hasn't been created yet.
 */
function findStreamTarget(): string | null {
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

const patchedFetch: typeof fetch = function (input, init) {
  // POST /api/write 시 x-sync-client-id 헤더 추가 (sender 식별용)
  if (init && init.method === 'POST' && input === '/api/write') {
    const fp = getHeader(init.headers, 'file-path');
    if (fp) {
      try {
        const decoded = hexToStr(fp);
        if (decoded === DB_PATH && init.headers) {
          setHeader(init.headers, 'x-sync-client-id', CLIENT_ID);
        }
      } catch {
        // hex 디코딩 실패 무시
      }
    }
  }

  // POST /proxy2 시 sync 헤더 추가
  if (init && init.method === 'POST' && input === '/proxy2') {
    if (!init.headers) init.headers = {};
    setHeader(init.headers, 'x-sync-client-id', CLIENT_ID);

    const target = findStreamTarget();
    if (target) {
      setHeader(init.headers, 'x-sync-stream-target', target);
    }
  }

  return originalFetch.call(window, input, init!);
};

window.fetch = patchedFetch;
