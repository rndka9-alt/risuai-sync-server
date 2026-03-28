import { syncFetch } from '../config';
import { state } from '../state';
import { serverLog } from '../serverLog';

/** reconnect 시 서버의 활성 스트림 목록으로 activeStreams 복원 (중복 요청 차단용) */
export function restoreActiveStreams(): void {
  syncFetch('/sync/streams/active')
    .then((r) => r.json() as Promise<{ streams: ReadonlyArray<{ id: string; targetCharId: string | null }> }>)
    .then((data) => {
      if (!data.streams || !data.streams.length) return;
      for (const info of data.streams) {
        if (state.activeStreams.has(info.id)) continue;
        state.activeStreams.set(info.id, {
          streamId: info.id,
          targetCharId: info.targetCharId,
          targetCharIndex: -1,
          targetChatIndex: -1,
          targetMsgIndex: -1,
          resolved: false,
          lastText: '',
        });
      }
    })
    .catch((e) => { serverLog('warn', 'restoreActiveStreams failed', { error: String(e) }); });
}
