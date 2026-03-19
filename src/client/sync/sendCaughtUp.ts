import { state } from '../state';

/** 서버에 catch-up 완료를 알림 → fresh 상태로 전환 */
export function sendCaughtUp(): void {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: 'caught-up' }));
  }
}
