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

  // Flush accumulated text if any was throttled
  if (stream.accumulatedText.length > 0) {
    const dataMsg: StreamDataMessage = {
      type: 'stream-data',
      streamId,
      text: stream.accumulatedText,
      timestamp: Date.now(),
    };
    broadcast(dataMsg, stream.senderClientId);
  }

  const endMsg: StreamEndMessage = {
    type: 'stream-end',
    streamId,
    targetCharId: stream.targetCharId,
    text: stream.accumulatedText,
    timestamp: Date.now(),
  };
  broadcast(endMsg, stream.senderClientId);
  activeStreams.delete(streamId);
}
