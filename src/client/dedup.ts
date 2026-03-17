/** charId → SHA-256 hex hash */
const remoteBlockHashCache = new Map<string, string>();

function getHeader(headers: HeadersInit, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === name.toLowerCase()) return value;
    }
    return null;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return headers[key];
  }
  return null;
}

function hexDecode(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return s;
}

const REMOTE_FILE_RE = /^remotes\/(.+)\.local\.bin$/;

/** file-path 헤더에서 remote block의 charId를 추출. remote block이 아니면 null. */
export function extractRemoteCharId(headers: HeadersInit): string | null {
  const fp = getHeader(headers, 'file-path');
  if (!fp) return null;
  try {
    const match = hexDecode(fp).match(REMOTE_FILE_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data.slice());
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 이전에 전송한 body와 동일한지 SHA-256 해시로 비교.
 * 동일하면 true (스킵 가능), 다르면 false (전송 필요) + 캐시 갱신.
 */
export async function isUnchangedRemoteBlock(charId: string, body: Uint8Array): Promise<boolean> {
  const hash = await computeSha256Hex(body);
  if (remoteBlockHashCache.get(charId) === hash) return true;
  remoteBlockHashCache.set(charId, hash);
  return false;
}

/** ReadableStream body → Uint8Array 변환. 다른 타입은 그대로 유지. */
export async function ensureBufferedBody(init: RequestInit): Promise<RequestInit> {
  if (!(init.body instanceof ReadableStream)) return init;
  const reader = init.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ...init, body: buf };
}
