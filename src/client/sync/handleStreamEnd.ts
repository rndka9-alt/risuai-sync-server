import { state } from '../state';
import type { StreamEndMessage } from '../../shared/types';
import { applyFinalText } from './utils/applyFinalText';
import { finalizeStream } from './utils/finalizeStream';
import { sendAck } from './utils/sendAck';

export function handleStreamEnd(msg: StreamEndMessage): void {
  const streamState = state.activeStreams.get(msg.streamId);

  if (msg.text && msg.targetCharId) {
    applyFinalText(msg.targetCharId, msg.text, streamState);
  } else if (streamState?.resolved) {
    finalizeStream(streamState);
  }

  if (streamState) {
    state.activeStreams.delete(msg.streamId);
  }

  sendAck(msg.streamId);
}
