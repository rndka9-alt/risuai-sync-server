/**
 * Barrel re-export — 기존 `import * as sync from './sync'` 호환.
 * 실제 구현은 utils/ 하위에 분리.
 */

// zombie 스트림 정리 타이머 (serverState에서 endStream을 참조할 수 없어 여기서 설정)
import { activeStreams, STREAM_TTL_MS } from './serverState';
import { endStream } from './utils/streaming';
import * as logger from './logger';

const streamCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [streamId, stream] of activeStreams) {
    if (now - stream.createdAt > STREAM_TTL_MS) {
      logger.warn('Zombie stream cleaned up', { streamId, senderClientId: stream.senderClientId, age: `${Math.round((now - stream.createdAt) / 1000)}s` });
      endStream(streamId);
    }
  }
}, 60_000);
streamCleanupTimer.unref();

// ─── Re-exports ───────────────────────────────────────────────────

export { removeClientCache, initClientRootCache } from './utils/clientCache';
export { isClientFresh } from './utils/freshness';
export { mergeRemoteBlock } from './utils/mergeRemoteBlock';
export { hexDecodeFilePath, isDbWrite, isDbRead, isRemoteBlockWrite, extractCharIdFromFilePath } from './utils/filePath';
export { processDbWrite } from './utils/processDbWrite';
export { processRemoteBlockWrite } from './utils/processRemoteBlockWrite';
export { broadcast, broadcastDbChanged, broadcastResponseCompleted } from './utils/broadcast';
export { createStream, processStreamChunk, endStream, findActiveStreamForChar, isWriteBlockedByStream, markSenderDisconnected } from './utils/streaming';
export { reserveDbWrite, enqueueDbWrite, skipDbWrite, reserveRemoteWrite, enqueueRemoteWrite, skipRemoteWrite } from './utils/writeQueue';
