import type { StreamDataMessage } from '../../../shared/types';
import { activeStreams, STREAM_BROADCAST_INTERVAL_MS } from '../../serverState';
import { broadcast } from '../broadcast';
import { parseSSEDeltas } from './utils/parseSSEDeltas';

export function processStreamChunk(streamId: string, chunk: Buffer): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  stream.lineBuffer += chunk.toString('utf-8');

  // Process complete lines only
  const lastNewline = stream.lineBuffer.lastIndexOf('\n');
  if (lastNewline === -1) return;

  const complete = stream.lineBuffer.slice(0, lastNewline + 1);
  stream.lineBuffer = stream.lineBuffer.slice(lastNewline + 1);

  const deltas = parseSSEDeltas(complete);
  if (deltas.length === 0) return;

  for (const delta of deltas) {
    stream.accumulatedText += delta;
  }

  // Throttle broadcasts
  const now = Date.now();
  if (now - stream.lastBroadcastTime >= STREAM_BROADCAST_INTERVAL_MS) {
    stream.lastBroadcastTime = now;
    const excludeClientId = stream.senderDisconnected ? null : stream.senderClientId;
    const msg: StreamDataMessage = {
      type: 'stream-data',
      streamId,
      text: stream.accumulatedText,
      timestamp: now,
    };
    broadcast(msg, excludeClientId);
  }
}
