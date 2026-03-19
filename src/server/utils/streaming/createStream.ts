import type { StreamStartMessage } from '../../../shared/types';
import { activeStreams } from '../../serverState';
import { broadcast } from '../broadcast';

export function createStream(
  streamId: string,
  senderClientId: string,
  targetCharId: string | null,
): void {
  activeStreams.set(streamId, {
    id: streamId,
    senderClientId,
    targetCharId,
    accumulatedText: '',
    lastBroadcastTime: 0,
    lineBuffer: '',
    createdAt: Date.now(),
    senderDisconnected: false,
  });

  const msg: StreamStartMessage = {
    type: 'stream-start',
    streamId,
    senderClientId,
    targetCharId,
    timestamp: Date.now(),
  };
  broadcast(msg, senderClientId);
}
