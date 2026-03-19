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
  | StreamEndMessage
  | WriteFailedMessage
  | PlainFetchWarningMessage;

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
  targetCharId: string | null;
  text: string;
  timestamp: number;
}

export interface WriteFailedMessage {
  type: 'write-failed';
  path: string;
  attempts: number;
  timestamp: number;
}

export interface PlainFetchWarningMessage {
  type: 'plain-fetch-warning';
  timestamp: number;
}

/** WebSocket 메시지: 클라이언트 → 서버 */
export type ClientMessage =
  | InitMessage
  | WriteNotifyMessage
  | StreamAckMessage
  | CaughtUpMessage;

export interface InitMessage {
  type: 'init';
}

export interface WriteNotifyMessage {
  type: 'write-notify';
  file: string;
}

export interface StreamAckMessage {
  type: 'stream-ack';
  streamId: string;
}

export interface CaughtUpMessage {
  type: 'caught-up';
}

/** HTTP API 응답 */
export interface ChangeLogEntry {
  version: number;
  timestamp: number;
  changed: BlockChange[];
  deleted: string[];
  senderClientId?: string | null;
}

/** 보관소(Parcel Locker): 미수신 완료 스트림 */
export interface PendingStream {
  id: string;
  targetCharId: string | null;
  text: string;
}

export interface ChangesResponse extends Versioned {
  changes: ChangeLogEntry[];
  pendingStreams?: PendingStream[];
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
