import { showWriteFailedNotification } from '../../notification';
import { ensureBufferedBody } from '../../dedup';

/** /api/write 재시도: 네트워크 에러 또는 5xx 시 exponential backoff */
const WRITE_MAX_RETRIES = 3;
const WRITE_RETRY_BASE_DELAY_MS = 1000;

const originalFetch = window.fetch;

export async function fetchWriteWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
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
