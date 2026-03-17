import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import crypto from 'crypto';
import { parseRisuSaveBlocks } from './parser';
import { BLOCK_TYPE, isSyncedRootKey, isIgnoredRootKey } from '../shared/blockTypes';
import type { BlockChange, ServerMessage, StreamStartMessage, StreamDataMessage, StreamEndMessage } from '../shared/types';
import * as cache from './cache';
import * as config from './config';
import * as logger from './logger';

// server/index.ts 에서 init()으로 주입
let clients: Map<string, WebSocket> | null = null;

/**
 * Per-client ROOT 데이터 캐시 — echo 방지용.
 * 각 클라이언트의 마지막 ROOT write를 저장하여,
 * 글로벌 diff와의 intersection으로 사전 존재 차이를 필터링한다.
 * disconnect 시 removeClientCache()로 정리.
 */
const clientRootCache = new Map<string, string>();

export function init(clientsMap: Map<string, WebSocket>): void {
  clients = clientsMap;
}

export function removeClientCache(clientId: string): void {
  clientRootCache.delete(clientId);
}

/** WS init 메시지 수신 시: 현재 글로벌 ROOT 캐시를 per-client baseline으로 복사 */
export function initClientRootCache(clientId: string): void {
  const rootJson = cache.dataCache.get('root');
  if (rootJson) {
    clientRootCache.set(clientId, rootJson);
  }
}

/** DB write 감지 */
function hexDecode(hex: string): string {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return s;
}

export function isDbWrite(req: IncomingMessage): boolean {
  if (req.method !== 'POST' || req.url !== '/api/write') return false;
  const fp = req.headers['file-path'];
  if (!fp || typeof fp !== 'string') return false;
  try {
    return hexDecode(fp) === config.DB_PATH;
  } catch {
    return false;
  }
}

/** Remote block write 감지 (Node 서버 모드: remotes/{charId}.local.bin) */
const REMOTE_FILE_RE = /^remotes\/(.+)\.local\.bin$/;

export function isRemoteBlockWrite(req: IncomingMessage): boolean {
  if (req.method !== 'POST' || req.url !== '/api/write') return false;
  const fp = req.headers['file-path'];
  if (!fp || typeof fp !== 'string') return false;
  try {
    return REMOTE_FILE_RE.test(hexDecode(fp));
  } catch {
    return false;
  }
}

export function extractCharIdFromFilePath(req: IncomingMessage): string | null {
  const fp = req.headers['file-path'];
  if (!fp || typeof fp !== 'string') return null;
  try {
    const match = hexDecode(fp).match(REMOTE_FILE_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** ROOT 블록 키 비교: 3분류 (SYNCED / IGNORED / unknown) */
interface DiffRootResult {
  syncedKeys: string[];   // SYNCED_ROOT_KEYS에 있는 변경 키
  unknownKeys: string[];  // 어디에도 없는 키 → reload 유도
  ignoredOnly: boolean;   // 변경이 전부 IGNORED 키뿐인지
}

function diffRootKeys(oldJson: string | null, newJson: string): DiffRootResult | null {
  if (!oldJson || !newJson) return null;
  try {
    const oldObj = JSON.parse(oldJson);
    const newObj = JSON.parse(newJson);
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj),
    ]);
    const syncedKeys: string[] = [];
    const unknownKeys: string[] = [];
    let hasIgnored = false;
    for (const key of allKeys) {
      if (key.startsWith('__')) continue; // __directory 등 메타 키 무시
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        if (isSyncedRootKey(key)) {
          syncedKeys.push(key);
        } else if (isIgnoredRootKey(key)) {
          hasIgnored = true;
        } else {
          unknownKeys.push(key);
        }
      }
    }
    const ignoredOnly = syncedKeys.length === 0 && unknownKeys.length === 0 && hasIgnored;
    return { syncedKeys, unknownKeys, ignoredOnly };
  } catch {
    return null; // 파싱 실패 시 null → 클라이언트에서 reload fallback
  }
}

/** ROOT 블록의 __directory(캐릭터 블록 목록) 변화를 감지 */
interface DirDiffResult {
  added: string[];
  deleted: string[];
}

/**
 * ROOT 블록의 __directory(캐릭터 블록 목록) 변화를 감지.
 * incremental save에서는 캐릭터 데이터 블록이 바이너리에 포함되지 않으므로,
 * __directory 비교가 캐릭터 추가/삭제의 유일한 감지 수단.
 *
 * @param excludeBlocks 현재 바이너리에 포함된 블록 이름 (블록 루프에서 이미 처리됨 → 중복 방지)
 */
function diffDirectory(
  oldRootJson: string | null,
  newRootJson: string,
  excludeBlocks: ReadonlySet<string>,
): DirDiffResult | null {
  if (!oldRootJson) return null;
  try {
    const oldDir = new Set<string>(JSON.parse(oldRootJson).__directory || []);
    const newDir: string[] = JSON.parse(newRootJson).__directory || [];
    const newDirSet = new Set(newDir);
    const added: string[] = [];
    const deleted: string[] = [];
    for (const entry of newDir) {
      if (!oldDir.has(entry) && !excludeBlocks.has(entry)) {
        added.push(entry);
      }
    }
    for (const entry of oldDir) {
      if (!newDirSet.has(entry)) {
        deleted.push(entry);
      }
    }
    if (added.length > 0 || deleted.length > 0) {
      logger.debug('diffDirectory', {
        oldDirSize: String(oldDir.size),
        newDirSize: String(newDir.length),
        added: JSON.stringify(added),
        deleted: JSON.stringify(deleted),
        oldDir: JSON.stringify([...oldDir]),
        newDir: JSON.stringify(newDir),
      });
    }
    return { added, deleted };
  } catch {
    return null;
  }
}

/** Remote block write 처리: 해시 비교 → broadcast (Node 서버 모드) */
export function processRemoteBlockWrite(
  buffer: Buffer,
  charId: string,
  senderClientId: string | null,
): void {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const jsonStr = buffer.toString('utf-8');

  try {
    JSON.parse(jsonStr);
  } catch {
    logger.error('Remote block is not valid JSON, skipping', { charId });
    return;
  }

  if (!cache.cacheInitialized) {
    // database.bin 이전에 도착한 경우: 캐시만 채움
    cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
    cache.dataCache.set(charId, jsonStr);
    logger.info('Remote block cached (pre-init)', { charId });
    return;
  }

  const cached = cache.hashCache.get(charId);
  if (cached && cached.hash === hash) {
    return;
  }

  cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
  cache.dataCache.set(charId, jsonStr);

  const blockChange: BlockChange = { name: charId, type: BLOCK_TYPE.WITH_CHAT };
  const isNew = !cached;
  const changed: BlockChange[] = isNew ? [] : [blockChange];
  const added: BlockChange[] = isNew ? [blockChange] : [];

  const version = cache.addChangeLogEntry(changed.concat(added), [], senderClientId);

  logger.info(`v${version}: remote block ${isNew ? 'added' : 'changed'}`, { charId, sender: senderClientId || 'unknown' });

  broadcast(
    { type: 'blocks-changed', epoch: cache.epoch, version, changed, added, deleted: [], timestamp: Date.now() },
    senderClientId,
  );

  if (senderClientId && clients!.has(senderClientId)) {
    const senderWs = clients!.get(senderClientId)!;
    if (senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'version-update', epoch: cache.epoch, version } satisfies ServerMessage));
    }
  }
}

/** DB write 처리: 파싱 → 해시 비교 → broadcast */
export function processDbWrite(buffer: Buffer, senderClientId: string | null): void {
  const parsed = parseRisuSaveBlocks(buffer);
  if (!parsed) {
    // 파싱 실패 → Phase 1 fallback
    broadcastDbChanged(senderClientId);
    return;
  }

  const { blocks, directory } = parsed;

  if (!cache.cacheInitialized) {
    // 첫 write: 캐시만 채움, broadcast 없음
    for (const [name, block] of blocks) {
      cache.hashCache.set(name, { type: block.type, hash: block.hash });
      cache.dataCache.set(name, block.json);
    }
    cache.setCacheInitialized(true);
    logger.info(`Cache initialized with ${blocks.size} blocks`);
    return;
  }

  const changed: BlockChange[] = [];
  const added: BlockChange[] = [];
  const deleted: string[] = [];

  for (const [name, block] of blocks) {
    const cached = cache.hashCache.get(name);
    if (!cached) {
      added.push({ name, type: block.type });
    } else if (cached.hash !== block.hash) {
      // ROOT 블록: 3분류 필터링
      if (block.type === BLOCK_TYPE.ROOT) {
        const globalOldJson = cache.dataCache.get(name);
        const globalDiff = diffRootKeys(globalOldJson, block.json);

        // hashCache에는 바이너리에 포함된 블록만 등록되므로,
        // incremental save 시 캐릭터 추가/삭제를 감지하지 못함.
        // __directory 비교로 보완. (항상 글로벌 캐시 기준)
        const blockNames = new Set(blocks.keys());
        const dirDiff = diffDirectory(globalOldJson, block.json, blockNames);
        if (dirDiff) {
          for (const entry of dirDiff.added) {
            added.push({ name: entry, type: BLOCK_TYPE.WITHOUT_CHAT });
          }
          for (const entry of dirDiff.deleted) {
            deleted.push(entry);
            cache.hashCache.delete(entry);
            cache.dataCache.delete(entry);
          }
        }

        // ROOT 변경 상세 debug 로깅
        if (globalDiff && globalDiff.syncedKeys.includes('pluginCustomStorage') && globalOldJson) {
          try {
            const oldRoot: { [k: string]: unknown } = JSON.parse(globalOldJson);
            const newRoot: { [k: string]: unknown } = JSON.parse(block.json);
            const oldPcs = (oldRoot.pluginCustomStorage || {}) as { [k: string]: unknown };
            const newPcs = (newRoot.pluginCustomStorage || {}) as { [k: string]: unknown };
            logger.diffObjects('pluginCustomStorage', oldPcs, newPcs);
          } catch { /* parse failure */ }
        }

        // Per-client intersection diff: 글로벌 diff와 클라이언트 diff의 교집합만 broadcast.
        // - 글로벌에만 있는 키: 사전 존재 차이 (echo) → 제외
        // - 클라이언트에만 있는 키: sync-apply 결과 (글로벌과 이미 동일) → 제외
        // - 양쪽 모두에 있는 키: 진짜 유저 변경 → broadcast
        const clientOldJson = senderClientId ? clientRootCache.get(senderClientId) : undefined;
        const clientDiff = clientOldJson ? diffRootKeys(clientOldJson, block.json) : null;

        if (globalDiff && clientDiff) {
          const clientSyncedSet = new Set(clientDiff.syncedKeys);
          const clientUnknownSet = new Set(clientDiff.unknownKeys);
          const effectiveSynced = globalDiff.syncedKeys.filter((k) => clientSyncedSet.has(k));
          const effectiveUnknown = globalDiff.unknownKeys.filter((k) => clientUnknownSet.has(k));

          if (effectiveSynced.length > 0 || effectiveUnknown.length > 0) {
            const entry: BlockChange = { name, type: block.type };
            entry.changedKeys = [...effectiveSynced, ...effectiveUnknown];
            entry.hasUnknownKeys = effectiveUnknown.length > 0;
            changed.push(entry);
          }
        } else if (globalDiff) {
          // per-client 캐시 없음 (첫 write) → 글로벌 diff fallback
          if (!globalDiff.ignoredOnly) {
            const entry: BlockChange = { name, type: block.type };
            entry.changedKeys = [...globalDiff.syncedKeys, ...globalDiff.unknownKeys];
            entry.hasUnknownKeys = globalDiff.unknownKeys.length > 0;
            changed.push(entry);
          }
        } else if (!globalDiff) {
          // diff 실패 (null) → 전체 reload fallback
          const entry: BlockChange = { name, type: block.type };
          entry.changedKeys = null;
          entry.hasUnknownKeys = true;
          changed.push(entry);
        }
      } else {
        changed.push({ name, type: block.type });
      }
    }
    // 캐시는 항상 업데이트 (IGNORED-only 변경도 포함)
    cache.hashCache.set(name, { type: block.type, hash: block.hash });
    cache.dataCache.set(name, block.json);
    if (block.type === BLOCK_TYPE.ROOT && senderClientId) {
      clientRootCache.set(senderClientId, block.json);
    }
  }

  if (changed.length === 0 && added.length === 0 && deleted.length === 0) {
    return;
  }

  const version = cache.addChangeLogEntry(changed.concat(added), deleted, senderClientId);

  logger.info(`v${version}: ${changed.length} changed, ${added.length} added, ${deleted.length} deleted`, {
    sender: senderClientId || 'unknown',
  });
  for (const c of changed) {
    logger.debug('changed', {
      name: c.name,
      type: String(c.type),
      changedKeys: c.changedKeys ? JSON.stringify(c.changedKeys) : 'all',
    });
  }
  for (const a of added) {
    logger.debug('added', { name: a.name, type: String(a.type) });
  }
  for (const d of deleted) {
    logger.debug('deleted', { name: d });
  }

  broadcast(
    { type: 'blocks-changed', epoch: cache.epoch, version, changed, added, deleted, timestamp: Date.now() },
    senderClientId,
  );

  // sender에게는 version만 알림 (catch-up 시 자기 변경분을 다시 받지 않도록)
  if (senderClientId && clients!.has(senderClientId)) {
    const senderWs = clients!.get(senderClientId)!;
    if (senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'version-update', epoch: cache.epoch, version } satisfies ServerMessage));
    }
  }
}

/** Broadcast */
function broadcast(payload: ServerMessage, excludeClientId: string | null): void {
  const data = JSON.stringify(payload);
  for (const [id, client] of clients!) {
    if (id !== excludeClientId && client.readyState === 1) {
      client.send(data);
    }
  }
}

export function broadcastDbChanged(excludeClientId: string | null): void {
  broadcast(
    { type: 'db-changed', file: config.DB_PATH, timestamp: Date.now() },
    excludeClientId,
  );
}

/** SSE Stream Parsing & Broadcasting */
interface ActiveStream {
  id: string;
  senderClientId: string;
  targetCharId: string | null;
  accumulatedText: string;
  lastBroadcastTime: number;
  lineBuffer: string;
}

const activeStreams = new Map<string, ActiveStream>();
const STREAM_BROADCAST_INTERVAL_MS = 50;

/** Streaming Protection: proxy2 & write drop 판정 */
export function findActiveStreamForChar(targetCharId: string | null): ActiveStream | null {
  if (!targetCharId) return null;
  for (const stream of activeStreams.values()) {
    if (stream.targetCharId === targetCharId) return stream;
  }
  return null;
}

export function isWriteBlockedByStream(senderClientId: string | null): boolean {
  if (activeStreams.size === 0) return false;
  for (const stream of activeStreams.values()) {
    if (stream.senderClientId !== senderClientId) return true;
  }
  return false;
}

export function createStream(
  streamId: string,
  senderClientId: string,
  targetCharId: string | null,
): void {
  const stream: ActiveStream = {
    id: streamId,
    senderClientId,
    targetCharId,
    accumulatedText: '',
    lastBroadcastTime: 0,
    lineBuffer: '',
  };
  activeStreams.set(streamId, stream);

  const msg: StreamStartMessage = {
    type: 'stream-start',
    streamId,
    senderClientId,
    targetCharId,
    timestamp: Date.now(),
  };
  broadcast(msg, senderClientId);
}

export function processStreamChunk(streamId: string, chunk: Buffer): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  stream.lineBuffer += chunk.toString('utf-8');

  // Process complete lines only
  const lastNewline = stream.lineBuffer.lastIndexOf('\n');
  if (lastNewline === -1) return;

  const complete = stream.lineBuffer.slice(0, lastNewline + 1);
  stream.lineBuffer = stream.lineBuffer.slice(lastNewline + 1);

  const deltas = parseSSEDeltas(complete);
  if (deltas.length === 0) return;

  for (const delta of deltas) {
    stream.accumulatedText += delta;
  }

  // Throttle broadcasts
  const now = Date.now();
  if (now - stream.lastBroadcastTime >= STREAM_BROADCAST_INTERVAL_MS) {
    stream.lastBroadcastTime = now;
    const msg: StreamDataMessage = {
      type: 'stream-data',
      streamId,
      text: stream.accumulatedText,
      timestamp: now,
    };
    broadcast(msg, stream.senderClientId);
  }
}

export function endStream(streamId: string): void {
  const stream = activeStreams.get(streamId);
  if (!stream) return;

  // Process any remaining data in line buffer
  if (stream.lineBuffer.trim()) {
    const deltas = parseSSEDeltas(stream.lineBuffer);
    for (const delta of deltas) {
      stream.accumulatedText += delta;
    }
  }

  // Flush accumulated text if any was throttled
  if (stream.accumulatedText.length > 0) {
    const dataMsg: StreamDataMessage = {
      type: 'stream-data',
      streamId,
      text: stream.accumulatedText,
      timestamp: Date.now(),
    };
    broadcast(dataMsg, stream.senderClientId);
  }

  const endMsg: StreamEndMessage = {
    type: 'stream-end',
    streamId,
    timestamp: Date.now(),
  };
  broadcast(endMsg, stream.senderClientId);
  activeStreams.delete(streamId);
}

/**
 * Parse SSE text to extract text deltas.
 * Handles OpenAI and Anthropic formats.
 * Best-effort: missing deltas are acceptable since final state comes from DB sync.
 */
function parseSSEDeltas(raw: string): string[] {
  const deltas: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6).trim();
    if (payload === '[DONE]' || payload === '') continue;

    try {
      const json = JSON.parse(payload);

      // OpenAI format: choices[].delta.content
      if (json.choices && Array.isArray(json.choices)) {
        for (const choice of json.choices) {
          const content = choice?.delta?.content;
          if (typeof content === 'string') {
            deltas.push(content);
          }
        }
        continue;
      }

      // Anthropic format: content_block_delta → delta.text
      if (json.type === 'content_block_delta') {
        const text = json.delta?.text;
        if (typeof text === 'string') {
          deltas.push(text);
        }
        continue;
      }
    } catch {
      // JSON parse failure — skip
    }
  }

  return deltas;
}
