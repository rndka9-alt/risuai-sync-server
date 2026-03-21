import { state } from '../state';
import type { StreamEndMessage } from '../../shared/types';
import { applyFinalText } from './utils/applyFinalText';
import { finalizeStream } from './utils/finalizeStream';
import { sendAck } from './utils/sendAck';

export function handleStreamEnd(msg: StreamEndMessage): void {
  const streamState = state.activeStreams.get(msg.streamId);

  let applied = false;
  if (msg.text && msg.targetCharId) {
    applied = applyFinalText(msg.targetCharId, msg.text, streamState);
  } else if (streamState?.resolved) {
    // 스트리밍 중 이미 텍스트가 적용됨 — finalize만 필요
    finalizeStream(streamState);
    applied = true;
  }

  if (streamState) {
    state.activeStreams.delete(msg.streamId);
  }

  if (applied) {
    sendAck(msg.streamId);
  }
}
