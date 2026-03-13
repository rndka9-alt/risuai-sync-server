import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { parseRisuSaveBlocks } from './parser';
import { BLOCK_TYPE } from '../shared/blockTypes';
import type { BlockChange, ServerMessage, StreamStartMessage, StreamDataMessage, StreamEndMessage } from '../shared/types';
import * as cache from './cache';
import * as config from './config';

// server/index.ts 에서 init()으로 주입
let clients: Map<string, WebSocket> | null = null;

export function init(clientsMap: Map<string, WebSocket>): void {
  clients = clientsMap;
}

// ---------------------------------------------------------------------------
// DB write 감지
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ROOT 블록 키 비교: 어떤 top-level 키가 변경되었는지 반환
// ---------------------------------------------------------------------------
function diffRootKeys(oldJson: string | null, newJson: string): string[] | null {
  if (!oldJson || !newJson) return null;
  try {
    const oldObj = JSON.parse(oldJson);
    const newObj = JSON.parse(newJson);
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj),
    ]);
    const changed: string[] = [];
    for (const key of allKeys) {
      if (key.startsWith('__')) continue; // __directory 등 메타 키 무시
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        changed.push(key);
      }
    }
    return changed;
  } catch {
    return null; // 파싱 실패 시 null → 클라이언트에서 reload fallback
  }
}

// ---------------------------------------------------------------------------
// DB write 처리: 파싱 → 해시 비교 → broadcast
// ---------------------------------------------------------------------------
export function processDbWrite(buffer: Buffer, senderClientId: string | null): void {
  const parsed = parseRisuSaveBlocks(buffer);
  if (!parsed) {
    // REMOTE 블록 또는 파싱 실패 → Phase 1 fallback
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
    cache.setCachedDirectory(directory);
    cache.setCacheInitialized(true);
    console.log(`[Sync] Cache initialized with ${blocks.size} blocks`);
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
      const entry: BlockChange = { name, type: block.type };

      // ROOT 블록: 변경된 top-level 키 목록 포함
      if (block.type === BLOCK_TYPE.ROOT) {
        entry.changedKeys = diffRootKeys(
          cache.dataCache.get(name),
          block.json,
        );
      }

      changed.push(entry);
    }
    cache.hashCache.set(name, { type: block.type, hash: block.hash });
    cache.dataCache.set(name, block.json);
  }

  // 디렉토리 비교로 삭제 감지
  const newDirSet = new Set(directory);
  for (const name of cache.cachedDirectory) {
    if (!newDirSet.has(name)) {
      deleted.push(name);
      cache.hashCache.delete(name);
      cache.dataCache.delete(name);
    }
  }

  cache.setCachedDirectory(directory);

  if (changed.length === 0 && added.length === 0 && deleted.length === 0) {
    return;
  }

  const version = cache.addChangeLogEntry(changed.concat(added), deleted, senderClientId);

  console.log(`[Sync] v${version}: ${changed.length} changed, ${added.length} added, ${deleted.length} deleted (sender: ${senderClientId || 'unknown'})`);
  changed.forEach((c) => {
    if (c.changedKeys) console.log(`[Sync]   ${c.name} (type ${c.type}): changedKeys=${JSON.stringify(c.changedKeys)}`);
    else console.log(`[Sync]   ${c.name} (type ${c.type})`);
  });

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

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// SSE Stream Parsing & Broadcasting
// ---------------------------------------------------------------------------
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
