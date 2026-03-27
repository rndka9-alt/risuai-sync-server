import type WebSocket from 'ws';
import db from './db';
import { WriteOrderQueue } from './write-order-queue';

// ─── WebSocket 클라이언트 (라이브 연결, 인메모리) ────────

export const clients = new Map<string, WebSocket>();
export const aliveState = new WeakMap<WebSocket, boolean>();

// ─── Client freshness (라이브 연결 상태, 인메모리) ───────
/** catch-up 완료된 클라이언트 — 이 Set에 없으면 stale로 간주하여 write 시 merge 적용 */
export const freshClients = new Set<string>();

// ─── Type guards ────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface ClientStateRow {
  client_id: string;
  root_cache: string | null;
  disconnected_at: number | null;
  trusted_at: number | null;
}

function isStringRow(v: unknown): v is { value: string } {
  return isRecord(v) && typeof v.value === 'string';
}

function isNumberRow(v: unknown): v is { value: number } {
  return isRecord(v) && typeof v.value === 'number';
}

// ─── Prepared statements ────────────────────────────────

const stmt = {
  // clientRootCache
  getRootCache: db.prepare('SELECT root_cache as value FROM client_state WHERE client_id = ?'),
  upsertRootCache: db.prepare(
    'INSERT INTO client_state (client_id, root_cache) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET root_cache = excluded.root_cache',
  ),
  hasRootCache: db.prepare('SELECT 1 FROM client_state WHERE client_id = ? AND root_cache IS NOT NULL'),
  clearRootCache: db.prepare('UPDATE client_state SET root_cache = NULL WHERE client_id = ?'),

  // clientDisconnectedAt
  upsertDisconnectedAt: db.prepare(
    'INSERT INTO client_state (client_id, disconnected_at) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET disconnected_at = excluded.disconnected_at',
  ),
  clearDisconnectedAt: db.prepare('UPDATE client_state SET disconnected_at = NULL WHERE client_id = ?'),

  // trustedClients
  getTrustedAt: db.prepare('SELECT trusted_at as value FROM client_state WHERE client_id = ?'),
  upsertTrustedAt: db.prepare(
    'INSERT INTO client_state (client_id, trusted_at) VALUES (?, ?) ON CONFLICT(client_id) DO UPDATE SET trusted_at = excluded.trusted_at',
  ),
  hasTrusted: db.prepare('SELECT 1 FROM client_state WHERE client_id = ? AND trusted_at IS NOT NULL'),
  clearTrustedAt: db.prepare('UPDATE client_state SET trusted_at = NULL WHERE client_id = ?'),
  clearAllTrusted: db.prepare('UPDATE client_state SET trusted_at = NULL'),

  // TTL cleanup
  cleanExpiredRootCache: db.prepare(
    'UPDATE client_state SET root_cache = NULL, disconnected_at = NULL WHERE disconnected_at IS NOT NULL AND disconnected_at < ?',
  ),
  cleanExpiredTrusted: db.prepare(
    'UPDATE client_state SET trusted_at = NULL WHERE trusted_at IS NOT NULL AND trusted_at < ?',
  ),
  removeEmptyRows: db.prepare(
    'DELETE FROM client_state WHERE root_cache IS NULL AND disconnected_at IS NULL AND trusted_at IS NULL',
  ),
};

// ─── Per-client ROOT 캐시 (echo 방지, SQLite) ───────────

/**
 * 각 클라이언트의 마지막 ROOT write를 저장하여,
 * 글로벌 diff와의 intersection으로 사전 존재 차이를 필터링한다.
 *
 * WS 연결 해제 시 즉시 삭제하지 않고 TTL(10분)을 두어,
 * 짧은 재연결 기간 동안 false delete를 방지한다.
 */
class SqliteClientRootCache {
  get(clientId: string): unknown | undefined {
    const row = stmt.getRootCache.get(clientId);
    if (!isStringRow(row) || row.value === null) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  set(clientId: string, value: unknown): void {
    const json = typeof value === 'string' ? value : JSON.stringify(value);
    stmt.upsertRootCache.run(clientId, json);
  }

  has(clientId: string): boolean {
    return stmt.hasRootCache.get(clientId) !== undefined;
  }

  delete(clientId: string): void {
    stmt.clearRootCache.run(clientId);
  }
}

export const clientRootCache = new SqliteClientRootCache();

// ─── 연결 해제 시각 (TTL 정리용, SQLite) ────────────────

/** 연결 해제 시각 기록 — TTL 정리용. 연결 중인 클라이언트는 엔트리 없음. */
class SqliteClientDisconnectedAt {
  set(clientId: string, timestamp: number): void {
    stmt.upsertDisconnectedAt.run(clientId, timestamp);
  }

  delete(clientId: string): void {
    stmt.clearDisconnectedAt.run(clientId);
  }
}

export const clientDisconnectedAt = new SqliteClientDisconnectedAt();
export const CLIENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

// ─── Grace period: WS 인증된 clientId 신뢰 (SQLite) ────

/** WS 인증 성공 시 기록. grace period 동안 HTTP/WS 재인증 시 토큰 검증 생략 */
class SqliteTrustedClients {
  get(clientId: string): number | undefined {
    const row = stmt.getTrustedAt.get(clientId);
    if (!isNumberRow(row)) return undefined;
    return row.value;
  }

  set(clientId: string, timestamp: number): void {
    stmt.upsertTrustedAt.run(clientId, timestamp);
  }

  has(clientId: string): boolean {
    return stmt.hasTrusted.get(clientId) !== undefined;
  }

  delete(clientId: string): void {
    stmt.clearTrustedAt.run(clientId);
  }

  clear(): void {
    stmt.clearAllTrusted.run();
  }
}

export const trustedClients = new SqliteTrustedClients();
export const TRUST_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h

// ─── TTL cleanup (SQL 기반, 인메모리 순회 불필요) ────────

const clientCacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  stmt.cleanExpiredRootCache.run(now - CLIENT_CACHE_TTL_MS);
  stmt.cleanExpiredTrusted.run(now - TRUST_GRACE_PERIOD_MS);
  stmt.removeEmptyRows.run();
}, 60_000);
clientCacheCleanupTimer.unref();

// ─── 활성 스트림 (라이브 상태, 인메모리) ────────────────

export interface ActiveStream {
  id: string;
  senderClientId: string;
  targetCharId: string | null;
  accumulatedText: string;
  lastBroadcastTime: number;
  lineBuffer: string;
  createdAt: number;
  /** Sender의 HTTP 연결이 끊긴 경우 true — broadcast에서 sender를 제외하지 않는다 */
  senderDisconnected: boolean;
}

export const activeStreams = new Map<string, ActiveStream>();
export const STREAM_BROADCAST_INTERVAL_MS = 50;

/** Zombie 스트림 정리: 30분 이상 살아있는 스트림을 강제 종료 */
export const STREAM_TTL_MS = 30 * 60 * 1000;

// zombie 스트림 정리 타이머는 endStream을 import해야 하므로 streaming/ 유틸에서 설정

// ─── Write 큐 (라이브 상태, 인메모리) ───────────────────

export const dbWriteQueue = new WriteOrderQueue();
export const remoteWriteQueues = new Map<string, WriteOrderQueue>();
