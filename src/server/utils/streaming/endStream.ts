import type { StreamDataMessage, StreamEndMessage } from '../../../shared/types';
import { activeStreams } from '../../serverState';
import { broadcast } from '../broadcast';
import { parseSSEDeltas } from './utils/parseSSEDeltas';

export function endStream(streamId: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  // Process any remaining data in line buffer
  if (stream.lineBuffer.trim()) {
    const deltas = parseSSEDeltas(stream.lineBuffer);
    for (const delta of deltas) {
      stream.accumulatedText += delta;
    }
  }

  // Sender의 HTTP 연결이 끊긴 경우, broadcast에서 sender를 제외하지 않는다.
  // (Android 백그라운드 등으로 HTTP SSE가 끊겼지만 WebSocket으로 재연결한 경우)
  const excludeClientId = stream.senderDisconnected ? null : stream.senderClientId;

  // Flush accumulated text if any was throttled
  if (stream.accumulatedText.length > 0) {
    const dataMsg: StreamDataMessage = {
      type: 'stream-data',
      streamId,
      text: stream.accumulatedText,
      timestamp: Date.now(),
    };
    broadcast(dataMsg, excludeClientId);
  }

  const endMsg: StreamEndMessage = {
    type: 'stream-end',
    streamId,
    targetCharId: stream.targetCharId,
    text: stream.accumulatedText,
    timestamp: Date.now(),
  };
  broadcast(endMsg, excludeClientId);
  activeStreams.delete(streamId);
}
