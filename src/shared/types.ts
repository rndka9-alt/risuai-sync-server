import type { BlockType } from './blockTypes';

/** 공통 base: 서버 재시작 감지용 epoch + 단조증가 version */
export interface Versioned {
  epoch: number;
  version: number;
}

/** 블록 변경 엔트리 (서버 broadcast + 클라이언트 수신 공통) */
export interface BlockChange {
  name: string;
  type: BlockType;
  changedKeys?: string[] | null;
  /** true if changedKeys contains keys not in SYNCED_ROOT_KEYS (client should reload) */
  hasUnknownKeys?: boolean;
}

/** WebSocket 메시지: 서버 → 클라이언트 */
export type ServerMessage =
  | BlocksChangedMessage
  | VersionUpdateMessage
  | DbChangedMessage
  | StreamStartMessage
  | StreamDataMessage
  | StreamEndMessage;

export interface BlocksChangedMessage extends Versioned {
  type: 'blocks-changed';
  changed: BlockChange[];
  added: BlockChange[];
  deleted: string[];
  timestamp: number;
}

export interface VersionUpdateMessage extends Versioned {
  type: 'version-update';
}

export interface DbChangedMessage {
  type: 'db-changed';
  file: string;
  timestamp: number;
}

export interface StreamStartMessage {
  type: 'stream-start';
  streamId: string;
  senderClientId: string;
  targetCharId: string | null;
  timestamp: number;
}

export interface StreamDataMessage {
  type: 'stream-data';
  streamId: string;
  text: string;
  timestamp: number;
}

export interface StreamEndMessage {
  type: 'stream-end';
  streamId: string;
  timestamp: number;
}

/** WebSocket 메시지: 클라이언트 → 서버 */
export type ClientMessage =
  | InitMessage
  | WriteNotifyMessage;

export interface InitMessage {
  type: 'init';
}

export interface WriteNotifyMessage {
  type: 'write-notify';
  file: string;
}

/** HTTP API 응답 */
export interface ChangeLogEntry {
  version: number;
  timestamp: number;
  changed: BlockChange[];
  deleted: string[];
  senderClientId?: string | null;
}

export interface ChangesResponse extends Versioned {
  changes: ChangeLogEntry[];
}

export interface ManifestResponse extends Versioned {
  cacheInitialized: boolean;
  blocks: { name: string; type: BlockType; hash: string }[];
  directory: string[];
}

export interface HealthResponse extends Versioned {
  status: 'ok';
  clients: number;
  cacheInitialized: boolean;
  cachedBlocks: number;
}
