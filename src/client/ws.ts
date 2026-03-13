import { SYNC_TOKEN, CLIENT_ID } from './config';
import { state, MAX_RECONNECT_DELAY } from './state';
import { catchUpFromServer, handleBlocksChanged, handleStreamStart, handleStreamData, handleStreamEnd } from './sync';
import { showNotification } from './notification';
import type { ServerMessage, ChangesResponse } from '../shared/types';

// ---------------------------------------------------------------------------
// WebSocket 연결
// ---------------------------------------------------------------------------
export function connect(): void {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url =
    protocol + '//' + location.host +
    '/sync/ws?token=' + encodeURIComponent(SYNC_TOKEN) +
    '&clientId=' + encodeURIComponent(CLIENT_ID);

  try {
    state.ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }

  state.ws.onopen = () => {
    console.log('[Sync] Connected');
    state.reconnectDelay = 1000;

    if (state.isFirstConnect) {
      // 첫 연결: 현재 버전 + epoch 가져옴
      fetch('/sync/changes?since=0&clientId=' + encodeURIComponent(CLIENT_ID))
        .then((r) => r.json() as Promise<ChangesResponse>)
        .then((data) => {
          state.epoch = data.epoch;
          state.lastVersion = data.version;
        })
        .catch(() => {});
      state.isFirstConnect = false;
      return;
    }

    // 재연결: 놓친 변경분 catch-up
    catchUpFromServer();
  };

  state.ws.onmessage = (event) => {
    try {
      if (typeof event.data !== 'string') return;
      const msg: ServerMessage = JSON.parse(event.data);
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

// ---------------------------------------------------------------------------
// visibilitychange: 탭 복귀 시 catch-up
// ---------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.lastVersion > 0) {
    catchUpFromServer();
  }
});
