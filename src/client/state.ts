// ---------------------------------------------------------------------------
// 클라이언트 공유 상태
// ---------------------------------------------------------------------------
interface ClientState {
  lastVersion: number;
  isFirstConnect: boolean;
  ws: WebSocket | null;
  reconnectDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  notificationEl: HTMLDivElement | null;
  dismissTimer: ReturnType<typeof setTimeout> | null;
}

export const state: ClientState = {
  lastVersion: 0,
  isFirstConnect: true,
  ws: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  notificationEl: null,
  dismissTimer: null,
};

export const MAX_RECONNECT_DELAY = 30000;
