// ---------------------------------------------------------------------------
// 클라이언트 공유 상태
// ---------------------------------------------------------------------------
export interface StreamState {
  streamId: string;
  targetCharId: string | null;
  targetCharIndex: number;
  targetChatIndex: number;
  targetMsgIndex: number;
  resolved: boolean;
  lastText: string;
}

interface ClientState {
  lastVersion: number;
  isFirstConnect: boolean;
  ws: WebSocket | null;
  reconnectDelay: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  notificationEl: HTMLDivElement | null;
  dismissTimer: ReturnType<typeof setTimeout> | null;
  activeStreams: Map<string, StreamState>;
}

export const state: ClientState = {
  lastVersion: 0,
  isFirstConnect: true,
  ws: null,
  reconnectDelay: 1000,
  reconnectTimer: null,
  notificationEl: null,
  dismissTimer: null,
  activeStreams: new Map(),
};

export const MAX_RECONNECT_DELAY = 30000;
