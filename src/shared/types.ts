import type { BlockType } from './blockTypes';

// ---------------------------------------------------------------------------
// 블록 변경 엔트리 (서버 broadcast + 클라이언트 수신 공통)
// ---------------------------------------------------------------------------
export interface BlockChange {
  name: string;
  type: BlockType;
  changedKeys?: string[] | null;
}

// ---------------------------------------------------------------------------
// WebSocket 메시지: 서버 → 클라이언트
// ---------------------------------------------------------------------------
export type ServerMessage =
  | BlocksChangedMessage
  | VersionUpdateMessage
  | DbChangedMessage;

export interface BlocksChangedMessage {
  type: 'blocks-changed';
  version: number;
  changed: BlockChange[];
  added: BlockChange[];
  deleted: string[];
  timestamp: number;
}

export interface VersionUpdateMessage {
  type: 'version-update';
  version: number;
}

export interface DbChangedMessage {
  type: 'db-changed';
  file: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// WebSocket 메시지: 클라이언트 → 서버
// ---------------------------------------------------------------------------
export type ClientMessage =
  | WriteNotifyMessage;

export interface WriteNotifyMessage {
  type: 'write-notify';
  file: string;
}

// ---------------------------------------------------------------------------
// HTTP API 응답
// ---------------------------------------------------------------------------
export interface ChangeLogEntry {
  version: number;
  timestamp: number;
  changed: BlockChange[];
  deleted: string[];
  senderClientId?: string | null;
}

export interface ChangesResponse {
  currentVersion: number;
  changes: ChangeLogEntry[];
}

export interface ManifestResponse {
  version: number;
  cacheInitialized: boolean;
  blocks: { name: string; type: BlockType; hash: string }[];
  directory: string[];
}

export interface HealthResponse {
  status: 'ok';
  clients: number;
  version: number;
  cacheInitialized: boolean;
  cachedBlocks: number;
}
