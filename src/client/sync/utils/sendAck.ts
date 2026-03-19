import { state } from '../../state';

/** 보관소: 수신 확인 → 서버가 버퍼 삭제 */
export function sendAck(streamId: string): void {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: 'stream-ack', streamId }));
  }
}
