import { CLIENT_ID, CLIENT_ID_HEADER, FILE_PATH_HEADER, PROXY2_TARGET_HEADER, REQUEST_ID_HEADER, RISU_AUTH_HEADER } from '../config';
import { extractRemoteCharId, isUnchangedRemoteBlock, ensureBufferedBody } from '../dedup';
import { hexDecode } from '../dedup/utils/hexDecode';
import { capture } from '../auth';
import { extractHeader } from '../utils/extractHeader';
import { setHeader } from './utils/setHeader';
import { findStreamTarget } from './utils/findStreamTarget';
import { fetchWriteWithRetry } from './utils/fetchWriteWithRetry';
import { extractSyncMarker } from './utils/extractSyncMarker';
import { buildProxy2Request } from './utils/redirectToProxy2';
import { getProxyUrls } from './utils/getProxyUrls';
import { showSyncFallbackNotice } from '../notification/showSyncFallbackNotice';
import { computeDelta, computeRemoteDelta, warmCache, warmRemoteCache } from '../deltaDb';
import { enqueueBatchWrite } from './utils/batchWriteBuffer';

/** hex-encoded "database/database.bin" */
const DB_BIN_HEX = Array.from(new TextEncoder().encode('database/database.bin'))
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('');

/** 백업 디바운스: 마지막 요청 후 1시간 뒤 한 번만 실제 전송 */
const BACKUP_DEBOUNCE_MS = 60 * 60 * 1000;
let backupTimer: ReturnType<typeof setTimeout> | null = null;
let latestBackupAuth: string = '';

/** fetch monkey-patch */
const originalFetch = window.fetch;

/** 클라이언트 rid 생성: 체인 전체에서 동일 요청 추적용 */
function generateRid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
}

const patchedFetch: typeof fetch = function (input, init) {
  // 모든 요청에 x-request-id 주입 (없을 때만)
  if (init?.headers && !extractHeader(init.headers, REQUEST_ID_HEADER)) {
    setHeader(init.headers, REQUEST_ID_HEADER, generateRid());
  }

  // risu-auth 캡처 (WS 인증용)
  const risuAuth = extractHeader(init?.headers, RISU_AUTH_HEADER);
  if (risuAuth) {
    capture(risuAuth);
  }

  // 외부 LLM 직접 요청 → sync 마커 감지 시 proxy2로 리다이렉트
  // input: string 또는 URL 객체 (fetchWithPlainFetch가 new URL(url) 사용)
  const inputUrl = input instanceof URL ? input.toString()
    : typeof input === 'string' ? input
    : null;
  if (init?.method === 'POST' && inputUrl && !inputUrl.startsWith('/')) {
    const marker = extractSyncMarker(init.body);
    if (marker) {
      const proxy2Init = buildProxy2Request(inputUrl, init, marker.cleanBody);
      return (async () => {
        try {
          return await patchedFetch('/proxy2', proxy2Init);
        } catch {
          showSyncFallbackNotice();
          return originalFetch.call(window, inputUrl, {
            ...init,
            body: marker.cleanBody,
          });
        }
      })();
    }
  }

  // URL prefix 매칭 → proxy2 리다이렉트 (LLM 마커 없는 일반 요청)
  if (inputUrl && !inputUrl.startsWith('/')) {
    const proxyUrls = getProxyUrls();
    const matched = proxyUrls.some((url) => inputUrl.startsWith(url));
    if (matched) {
      const proxy2Init = buildProxy2Request(inputUrl, init ?? {}, init?.body);
      return (async () => {
        try {
          return await patchedFetch('/proxy2', proxy2Init);
        } catch {
          showSyncFallbackNotice();
          return originalFetch.call(window, input, init);
        }
      })();
    }
  }

  // POST /api/write 시 클라이언트 ID 헤더 추가 + 재시도 래핑
  if (init && init.method === 'POST' && input === '/api/write' && init.headers) {
    setHeader(init.headers, CLIENT_ID_HEADER, CLIENT_ID);

    const filePath = extractHeader(init.headers, FILE_PATH_HEADER);

    // 불필요한 write 차단 + 경량화
    if (filePath) {
      try {
        const decoded = hexDecode(filePath);
        if (decoded.includes('.meta.meta')) {
          return Promise.resolve(new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }
        // dbbackup → 1시간 디바운스 후 서버 캐시로 백업 (database.bin은 이미 저장됨)
        if (decoded.includes('dbbackup-')) {
          latestBackupAuth = extractHeader(init.headers, RISU_AUTH_HEADER) ?? '';
          if (backupTimer) clearTimeout(backupTimer);
          backupTimer = setTimeout(() => {
            backupTimer = null;
            sendBackupRequest({ [RISU_AUTH_HEADER]: latestBackupAuth });
          }, BACKUP_DEBOUNCE_MS);
          return Promise.resolve(new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }
      } catch {
        // hex 디코딩 실패 시 정상 전달
      }
    }

    // database.bin → delta 시도, 실패 시 전체 전송 fallback
    if (filePath === DB_BIN_HEX) {
      return (async () => {
        const buffered = await ensureBufferedBody(init);
        const body = buffered.body;
        if (body instanceof Uint8Array) {
          const result = computeDelta(body);
          if (result === 'no_changes') {
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (result !== 'no_cache') {
            const resp = await sendDelta(result, buffered.headers);
            if (resp) return resp;
          }
        }
        return fetchWriteWithRetry(input, buffered);
      })();
    }

    // Remote block write → delta 시도, 실패 시 전체 전송 fallback
    const charId = extractRemoteCharId(init.headers);
    if (charId) {
      return (async () => {
        const buffered = await ensureBufferedBody(init);
        const body = buffered.body;
        if (body instanceof Uint8Array) {
          // dedup: 해시가 동일하면 요청 자체를 보내지 않음
          try {
            if (await isUnchangedRemoteBlock(charId, body)) {
              return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
          } catch {
            // dedup 실패 시 계속 진행
          }

          // delta 시도
          const delta = computeRemoteDelta(charId, body);
          if (delta) {
            const resp = await sendDelta(delta, buffered.headers);
            if (resp) return resp;
          }
        }
        return fetchWriteWithRetry(input, buffered);
      })();
    }

    // 에셋 등 diff 불필요 파일 → 배치 버퍼로 모아서 한 번에 전송
    if (filePath) {
      return (async () => {
        const buffered = await ensureBufferedBody(init);
        const body = buffered.body;
        if (body instanceof Uint8Array) {
          return enqueueBatchWrite(filePath, body, buffered);
        }
        return fetchWriteWithRetry(input, buffered);
      })();
    }

    return fetchWriteWithRetry(input, init);
  }

  // POST /proxy2 시 sync 헤더 추가
  if (init && init.method === 'POST' && input === '/proxy2') {
    const target = findStreamTarget();

    if (!init.headers) init.headers = {};
    setHeader(init.headers, CLIENT_ID_HEADER, CLIENT_ID);
    if (target) {
      setHeader(init.headers, PROXY2_TARGET_HEADER, target);
    }
  }

  // GET /api/read → delta 캐시 warm
  if (input === '/api/read' && (!init?.method || init.method === 'GET')) {
    const fp = extractHeader(init?.headers, FILE_PATH_HEADER);
    if (fp === DB_BIN_HEX) {
      return originalFetch.call(window, input, init!).then((resp: Response) => {
        if (resp.ok) {
          const cloned = resp.clone();
          cloned.arrayBuffer().then((buf) => {
            warmCache(new Uint8Array(buf));
          }).catch(() => {});
        }
        return resp;
      });
    }
    // remote block read → 캐시 warm (첫 write부터 delta 가능)
    const charId = fp ? extractRemoteCharId({ [FILE_PATH_HEADER]: fp }) : null;
    if (charId) {
      return originalFetch.call(window, input, init!).then((resp: Response) => {
        if (resp.ok) {
          const cloned = resp.clone();
          cloned.arrayBuffer().then((buf) => {
            warmRemoteCache(charId, new Uint8Array(buf));
          }).catch(() => {});
        }
        return resp;
      });
    }
  }

  return originalFetch.call(window, input, init!);
};

/** /sync/backup 요청. sync 서버가 cached binary로 backup write. 실패 시 null. */
async function sendBackupRequest(headers: HeadersInit): Promise<Response | null> {
  try {
    const resp = await originalFetch.call(window, '/sync/backup', {
      method: 'POST',
      headers: {
        [RISU_AUTH_HEADER]: extractHeader(headers, RISU_AUTH_HEADER) ?? '',
        [CLIENT_ID_HEADER]: CLIENT_ID,
      },
    });
    if (resp.ok) return resp;
  } catch {
    // 실패 → caller가 full write fallback
  }
  return null;
}

/** delta payload를 /sync/delta-write로 전송. 성공 시 Response, 실패 시 null. */
async function sendDelta(delta: import('../deltaDb').DeltaPayload, headers: HeadersInit): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await originalFetch.call(window, '/sync/delta-write', {
      method: 'POST',
      body: JSON.stringify(delta),
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        [RISU_AUTH_HEADER]: extractHeader(headers, RISU_AUTH_HEADER) ?? '',
        [CLIENT_ID_HEADER]: CLIENT_ID,
      },
    });
    clearTimeout(timeout);
    if (resp.ok) return resp;
  } catch {
    // delta 실패 → caller가 full write fallback
  }
  return null;
}

window.fetch = patchedFetch;
