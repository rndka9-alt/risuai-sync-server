import { CLIENT_ID, CLIENT_ID_HEADER, PROXY2_TARGET_HEADER } from './config';
import { state } from './state';
import type { StreamState } from './state';
import { showWriteFailedNotification } from './notification';
import { extractRemoteCharId, isUnchangedRemoteBlock, ensureBufferedBody } from './dedup';

/** fetch monkey-patch */
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

/** /api/write 재시도: 네트워크 에러 또는 5xx 시 exponential backoff */
const WRITE_MAX_RETRIES = 3;
const WRITE_RETRY_BASE_DELAY_MS = 1000;

async function fetchWriteWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  init = await ensureBufferedBody(init);

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= WRITE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = WRITE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const response = await originalFetch.call(window, input, init);
      // 2xx~4xx: 성공 또는 클라이언트 에러 → 재시도 불필요
      if (response.ok || response.status < 500) return response;
      // 5xx: 서버 에러 → 재시도
      lastResponse = response;
    } catch (err) {
      // 네트워크 에러 (TypeError) → 재시도
      lastError = err;
    }
  }

  showWriteFailedNotification();

  if (lastResponse) return lastResponse;
  throw lastError;
}

const patchedFetch: typeof fetch = function (input, init) {
  // POST /api/write 시 클라이언트 ID 헤더 추가 + 재시도 래핑
  if (init && init.method === 'POST' && input === '/api/write' && init.headers) {
    setHeader(init.headers, CLIENT_ID_HEADER, CLIENT_ID);

    // Remote block write dedup: 해시가 동일하면 요청 자체를 보내지 않음
    const charId = extractRemoteCharId(init.headers);
    if (charId) {
      return (async () => {
        const buffered = await ensureBufferedBody(init);
        try {
          const body = buffered.body;
          if (body instanceof Uint8Array &&
              await isUnchangedRemoteBlock(charId, body)) {
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
        } catch {
          // dedup 실패 시 정상 전달
        }
        return fetchWriteWithRetry(input, buffered);
      })();
    }

    return fetchWriteWithRetry(input, init);
  }

  // POST /proxy2 시 스트리밍 보호 + sync 헤더 추가
  if (init && init.method === 'POST' && input === '/proxy2') {
    const target = findStreamTarget();

    // 1차 방어: 다른 기기의 스트리밍이 활성 상태인 캐릭터면 즉시 차단
    if (target) {
      const hasActiveStream = [...state.activeStreams.values()]
        .some((s) => s.targetCharId === target);
      if (hasActiveStream) {
        return Promise.resolve(new Response(
          JSON.stringify({ error: 'streaming_in_progress', message: 'Another device is streaming to this character' }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ));
      }
    }

    if (!init.headers) init.headers = {};
    setHeader(init.headers, CLIENT_ID_HEADER, CLIENT_ID);
    if (target) {
      setHeader(init.headers, PROXY2_TARGET_HEADER, target);
    }
  }

  return originalFetch.call(window, input, init!).then((response) => {
    // 서버 409 수신 시 activeStreams 복구 (새로고침 후 fallback)
    if (init?.method === 'POST' && input === '/proxy2' && response.status === 409) {
      response.clone().json().then((body: { error?: string; streamId?: string; targetCharId?: string }) => {
        if (body.error === 'streaming_in_progress' && body.streamId && body.targetCharId) {
          if (!state.activeStreams.has(body.streamId)) {
            const placeholder: StreamState = {
              streamId: body.streamId,
              targetCharId: body.targetCharId,
              targetCharIndex: -1,
              targetChatIndex: -1,
              targetMsgIndex: -1,
              resolved: false,
              lastText: '',
            };
            state.activeStreams.set(body.streamId, placeholder);
          }
        }
      }).catch(() => {});
    }
    return response;
  });
};

window.fetch = patchedFetch;
