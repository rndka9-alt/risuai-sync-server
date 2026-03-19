import { CLIENT_ID, CLIENT_ID_HEADER, PROXY2_TARGET_HEADER, RISU_AUTH_HEADER } from '../config';
import { state } from '../state';
import type { StreamState } from '../state';
import { extractRemoteCharId, isUnchangedRemoteBlock, ensureBufferedBody } from '../dedup';
import { capture } from '../auth';
import { extractHeader } from '../utils/extractHeader';
import { setHeader } from './utils/setHeader';
import { findStreamTarget } from './utils/findStreamTarget';
import { fetchWriteWithRetry } from './utils/fetchWriteWithRetry';

/** fetch monkey-patch */
const originalFetch = window.fetch;

const patchedFetch: typeof fetch = function (input, init) {
  // risu-auth 캡처 (WS 인증용)
  const risuAuth = extractHeader(init?.headers, RISU_AUTH_HEADER);
  if (risuAuth) {
    capture(risuAuth);
  }

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
