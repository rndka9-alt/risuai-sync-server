import { CLIENT_ID, CLIENT_ID_HEADER, RISU_AUTH_HEADER } from '../../config';
import { extractHeader } from '../../utils/extractHeader';
import { fetchWriteWithRetry } from './fetchWriteWithRetry';

/**
 * 에셋 write를 50ms 윈도우로 모아 /sync/batch-write 한 번에 전송.
 * 10MB 초과 시 청크를 나눠 병렬 전송한다.
 * 배치 전송 실패 시 개별 fetchWriteWithRetry로 fallback.
 */

interface PendingWrite {
  filePath: string;
  body: Uint8Array;
  init: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

const pending: PendingWrite[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 50;
const CHUNK_MAX_BYTES = 10 * 1024 * 1024;

const originalFetch = window.fetch;

export function enqueueBatchWrite(
  filePath: string,
  body: Uint8Array,
  init: RequestInit,
): Promise<Response> {
  captureAuth(init.headers);
  return new Promise<Response>((resolve, reject) => {
    pending.push({ filePath, body, init, resolve, reject });
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, DEBOUNCE_MS);
  });
}

/** risu-auth 토큰 캡처 — 배치 전송 시 사용 */
let cachedAuth = '';
function captureAuth(headers: HeadersInit | undefined): void {
  if (!headers) return;
  const token = extractHeader(headers, RISU_AUTH_HEADER);
  if (token) cachedAuth = token;
}

function flush(): void {
  const batch = pending.splice(0);
  flushTimer = null;
  if (batch.length === 0) return;

  const chunks = splitIntoChunks(batch);
  for (const chunk of chunks) {
    sendChunk(chunk);
  }
}

function splitIntoChunks(writes: PendingWrite[]): PendingWrite[][] {
  const chunks: PendingWrite[][] = [];
  let current: PendingWrite[] = [];
  let currentSize = 0;

  for (const w of writes) {
    if (current.length > 0 && currentSize + w.body.byteLength > CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(w);
    currentSize += w.body.byteLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 배치 바이너리 직렬화:
 * [4B BE: JSON 헤더 길이][JSON 헤더][파일 본문1][파일 본문2]...
 */
function buildPayload(writes: PendingWrite[]): ArrayBuffer {
  const header = JSON.stringify({
    files: writes.map((w) => ({ filePath: w.filePath, size: w.body.byteLength })),
  });
  const headerBytes = new TextEncoder().encode(header);

  const totalBody = writes.reduce((sum, w) => sum + w.body.byteLength, 0);
  const buf = new ArrayBuffer(4 + headerBytes.byteLength + totalBody);
  const payload = new Uint8Array(buf);
  const view = new DataView(buf);

  view.setUint32(0, headerBytes.byteLength, false);
  payload.set(headerBytes, 4);

  let offset = 4 + headerBytes.byteLength;
  for (const w of writes) {
    payload.set(w.body, offset);
    offset += w.body.byteLength;
  }
  return buf;
}

interface BatchResult {
  ok: boolean;
  status?: number;
}

async function sendChunk(writes: PendingWrite[]): Promise<void> {
  try {
    const payload = buildPayload(writes);
    const resp = await originalFetch.call(window, '/sync/batch-write', {
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/octet-stream',
        [RISU_AUTH_HEADER]: cachedAuth,
        [CLIENT_ID_HEADER]: CLIENT_ID,
      },
    });

    if (!resp.ok) {
      fallbackAll(writes);
      return;
    }

    const json: { results: BatchResult[] } = await resp.json();
    for (let i = 0; i < writes.length; i++) {
      const r = json.results[i];
      if (r?.ok) {
        writes[i].resolve(new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      } else {
        fallbackOne(writes[i]);
      }
    }
  } catch {
    fallbackAll(writes);
  }
}

/** 배치 실패 시 개별 /api/write로 fallback — P1 투명성 보장 */
function fallbackOne(w: PendingWrite): void {
  fetchWriteWithRetry('/api/write', w.init).then(w.resolve, w.reject);
}

function fallbackAll(writes: PendingWrite[]): void {
  for (const w of writes) {
    fallbackOne(w);
  }
}
