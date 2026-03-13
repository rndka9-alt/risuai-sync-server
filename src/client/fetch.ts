import { DB_PATH, CLIENT_ID } from './config';

// ---------------------------------------------------------------------------
// fetch monkey-patch
// ---------------------------------------------------------------------------
const originalFetch = window.fetch;

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

  return originalFetch.call(window, input, init!);
};

window.fetch = patchedFetch;
