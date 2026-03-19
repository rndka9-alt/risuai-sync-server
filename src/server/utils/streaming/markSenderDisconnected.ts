import { activeStreams } from '../../serverState';

/** Sender의 HTTP 연결이 끊겼음을 표시 — 이후 broadcast에서 sender를 제외하지 않는다 */
export function markSenderDisconnected(streamId: string): void {
  const stream = activeStreams.get(streamId);
  if (stream) {
    stream.senderDisconnected = true;
  }
}
