import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';

/**
 * Monitor heartbeat 용 활성 스트림 pool.
 * pushLlmEvent의 start/end 이벤트와 동기화된다.
 * /_internal/streams에서 이 pool을 조회하여
 * pending/SSE/non-SSE 구분 없이 활성 상태를 판단한다.
 */
const activeStreamIds = new Set<string>();

export function getActiveStreamIds(): ReadonlySet<string> {
  return activeStreamIds;
}

export function pushLlmEvent(event: Record<string, unknown>): void {
  const type = event.type;
  const streamId = typeof event.streamId === 'string' ? event.streamId : '';

  if (streamId) {
    if (type === 'start') activeStreamIds.add(streamId);
    if (type === 'end') activeStreamIds.delete(streamId);
  }

  if (!config.MONITOR_URL) return;

  const body = JSON.stringify(event);

  let url: URL;
  try {
    url = new URL('/_api/llm-event', config.MONITOR_URL);
  } catch {
    return;
  }

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      },
      timeout: 30_000,
    },
    (res) => {
      res.resume();
    },
  );

  req.on('error', (err) => {
    logger.debug('Monitor push failed', { error: err.message });
  });
  req.on('timeout', () => req.destroy());
  req.end(body);
}
