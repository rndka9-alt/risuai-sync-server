import type WebSocket from 'ws';
import { WriteOrderQueue } from './write-order-queue';
import * as logger from './logger';

// ─── WebSocket 클라이언트 ─────────────────────────────────────────

export const clients = new Map<string, WebSocket>();
export const aliveState = new WeakMap<WebSocket, boolean>();

// ─── Per-client ROOT 캐시 (echo 방지) ─────────────────────────────

/**
 * 각 클라이언트의 마지막 ROOT write를 저장하여,
 * 글로벌 diff와의 intersection으로 사전 존재 차이를 필터링한다.
 *
 * WS 연결 해제 시 즉시 삭제하지 않고 TTL(10분)을 두어,
 * 짧은 재연결 기간 동안 false delete를 방지한다.
 */
export const clientRootCache = new Map<string, string>();

/** 연결 해제 시각 기록 — TTL 정리용. 연결 중인 클라이언트는 엔트리 없음. */
export const clientDisconnectedAt = new Map<string, number>();
export const CLIENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10분

const clientCacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [clientId, disconnectedAt] of clientDisconnectedAt) {
    if (now - disconnectedAt > CLIENT_CACHE_TTL_MS) {
      clientRootCache.delete(clientId);
      clientDisconnectedAt.delete(clientId);
    }
  }
}, 60_000);
clientCacheCleanupTimer.unref();

// ─── 활성 스트림 ──────────────────────────────────────────────────

export interface ActiveStream {
  id: string;
  senderClientId: string;
  targetCharId: string | null;
  accumulatedText: string;
  lastBroadcastTime: number;
  lineBuffer: string;
  createdAt: number;
}

export const activeStreams = new Map<string, ActiveStream>();
export const STREAM_BROADCAST_INTERVAL_MS = 50;

/** Zombie 스트림 정리: 30분 이상 살아있는 스트림을 강제 종료 */
export const STREAM_TTL_MS = 30 * 60 * 1000;

// zombie 스트림 정리 타이머는 endStream을 import해야 하므로 streaming/ 유틸에서 설정

// ─── Write 큐 ─────────────────────────────────────────────────────

export const dbWriteQueue = new WriteOrderQueue();
export const remoteWriteQueues = new Map<string, WriteOrderQueue>();
