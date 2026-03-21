import { CLIENT_ID, syncFetch } from './config';
import { state, MAX_RECONNECT_DELAY } from './state';
import { catchUpFromServer, sendCaughtUp, restoreActiveStreams, handleBlocksChanged, handleStreamStart, handleStreamData, handleStreamEnd, processPendingStreams } from './sync';
import { showNotification, showWriteFailedNotification, showPlainFetchWarning } from './notification';
import { reloadOnEpochMismatch } from './epochReload';
import type { ServerMessage, ChangesResponse } from '../shared/types';
import { getToken, waitForToken } from './auth';

/** WebSocket 연결 */
export async function connect(): Promise<void> {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  // 최초 연결: RisuAI가 인증 요청을 보낼 때까지 대기
  let token = getToken();
  if (!token) {
    await waitForToken();
    token = getToken();
  }
  if (!token) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url =
    protocol + '//' + location.host +
    '/sync/ws?clientId=' + encodeURIComponent(CLIENT_ID);

  try {
    state.ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  state.ws.onopen = () => {
    // 첫 메시지로 인증 요청
    state.ws!.send(JSON.stringify({ type: 'auth', token }));
  };

  state.ws.onmessage = (event) => {
    try {
      if (typeof event.data !== 'string') return;
      const msg: ServerMessage = JSON.parse(event.data);

      if (msg.type === 'auth-result') {
        // epoch 불일치 감지: auth 성공/실패와 무관하게 서버 재시작 시 reload
        if (msg.epoch && state.epoch && state.epoch !== msg.epoch) {
          reloadOnEpochMismatch('auth-result', state.epoch, msg.epoch);
          return;
        }

        if (!msg.success) {
          // Auth failed — onclose → scheduleReconnect
          return; // onclose → scheduleReconnect
        }

        state.reconnectDelay = 1000;

        state.ws!.send(JSON.stringify({ type: 'init' }));
        restoreActiveStreams();

        if (state.isFirstConnect) {
          syncFetch('/sync/changes?since=0&clientId=' + encodeURIComponent(CLIENT_ID))
            .then((r) => {
              if (!r.ok) return null;
              return r.json() as Promise<ChangesResponse>;
            })
            .then((data) => {
              if (!data) return;
              state.epoch = data.epoch;
              state.lastVersion = data.version;

              if (data.pendingStreams && data.pendingStreams.length > 0) {
                processPendingStreams(data.pendingStreams);
              }

              sendCaughtUp();
            })
            .catch(() => {});
          state.isFirstConnect = false;
          return;
        }

        catchUpFromServer();
        return;
      }

      if (msg.type === 'blocks-changed') {
        if (state.epoch && state.epoch !== msg.epoch) {
          showNotification();
          return;
        }
        state.epoch = msg.epoch;
        state.lastVersion = msg.version || state.lastVersion;
        handleBlocksChanged(msg);
      } else if (msg.type === 'version-update') {
        if (state.epoch && state.epoch !== msg.epoch) {
          showNotification();
          return;
        }
        state.epoch = msg.epoch;
        state.lastVersion = msg.version || state.lastVersion;
      } else if (msg.type === 'db-changed') {
        showNotification(); // Phase 1 fallback
      } else if (msg.type === 'stream-start') {
        handleStreamStart(msg);
      } else if (msg.type === 'stream-data') {
        handleStreamData(msg);
      } else if (msg.type === 'stream-end') {
        handleStreamEnd(msg);
      } else if (msg.type === 'write-failed') {
        showWriteFailedNotification();
      } else if (msg.type === 'plain-fetch-warning') {
        showPlainFetchWarning();
      }
    } catch {
      // 파싱 실패 무시
    }
  };

  state.ws.onclose = () => {
    state.ws = null;
    scheduleReconnect();
  };

  state.ws.onerror = () => {
    // onclose가 뒤따라 호출됨
  };
}

function scheduleReconnect(): void {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, state.reconnectDelay);
  state.reconnectDelay = Math.min(state.reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

/** visibilitychange: 탭 복귀 시 catch-up */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.lastVersion > 0) {
    restoreActiveStreams();
    catchUpFromServer();
  }
});
