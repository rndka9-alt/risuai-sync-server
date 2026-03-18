import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from 'http';
import { BLOCK_TYPE } from '../shared/blockTypes';
import {
  buildBlock, buildRisuSave, hexEncode,
  createMockWs, sentMessages, clearSent,
} from './test-helpers';

vi.mock('./config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),
  SYNC_TOKEN: 'test-token',
  DB_PATH: 'database/database.bin',
  MAX_CACHE_SIZE: 1048576,
  MAX_LOG_ENTRIES: 100,
  LOG_LEVEL: 'error',
  SCRIPT_TAG: '',
}));

vi.mock('./logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  diffObjects: vi.fn(),
  isDebug: false,
}));

function mockReq(method: string, url: string, headers: { [key: string]: string } = {}) {
  // @ts-expect-error partial IncomingMessage for testing
  const req: IncomingMessage = { method, url, headers };
  return req;
}

// ─── Request Detection ─────────────────────────────────────────────

describe('isDbWrite', () => {
  let sync: typeof import('./sync');

  beforeEach(async () => {
    vi.resetModules();
    sync = await import('./sync');
  });

  it('detects database.bin write via hex-encoded file-path', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbWrite(req)).toBe(true);
  });

  it('rejects non-POST methods', () => {
    const req = mockReq('GET', '/api/write', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbWrite(req)).toBe(false);
  });

  it('rejects wrong URL', () => {
    const req = mockReq('POST', '/api/read', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbWrite(req)).toBe(false);
  });

  it('rejects different file paths', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('other/file.bin'),
    });
    expect(sync.isDbWrite(req)).toBe(false);
  });

  it('rejects missing file-path header', () => {
    const req = mockReq('POST', '/api/write');
    expect(sync.isDbWrite(req)).toBe(false);
  });
});

describe('isDbRead', () => {
  let sync: typeof import('./sync');

  beforeEach(async () => {
    vi.resetModules();
    sync = await import('./sync');
  });

  it('detects database.bin read via hex-encoded file-path', () => {
    const req = mockReq('GET', '/api/read', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbRead(req)).toBe(true);
  });

  it('rejects non-GET methods', () => {
    const req = mockReq('POST', '/api/read', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbRead(req)).toBe(false);
  });

  it('rejects wrong URL', () => {
    const req = mockReq('GET', '/api/write', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isDbRead(req)).toBe(false);
  });

  it('rejects different file paths', () => {
    const req = mockReq('GET', '/api/read', {
      'file-path': hexEncode('other/file.bin'),
    });
    expect(sync.isDbRead(req)).toBe(false);
  });

  it('rejects missing file-path header', () => {
    const req = mockReq('GET', '/api/read');
    expect(sync.isDbRead(req)).toBe(false);
  });
});

describe('isRemoteBlockWrite', () => {
  let sync: typeof import('./sync');

  beforeEach(async () => {
    vi.resetModules();
    sync = await import('./sync');
  });

  it('detects remote block write', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('remotes/char1.local.bin'),
    });
    expect(sync.isRemoteBlockWrite(req)).toBe(true);
  });

  it('rejects non-remote paths', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.isRemoteBlockWrite(req)).toBe(false);
  });
});

describe('extractCharIdFromFilePath', () => {
  let sync: typeof import('./sync');

  beforeEach(async () => {
    vi.resetModules();
    sync = await import('./sync');
  });

  it('extracts character ID from remote block path', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('remotes/my-char-id.local.bin'),
    });
    expect(sync.extractCharIdFromFilePath(req)).toBe('my-char-id');
  });

  it('returns null for non-remote paths', () => {
    const req = mockReq('POST', '/api/write', {
      'file-path': hexEncode('database/database.bin'),
    });
    expect(sync.extractCharIdFromFilePath(req)).toBeNull();
  });
});

// ─── processDbWrite ────────────────────────────────────────────────

describe('processDbWrite', () => {
  let cache: typeof import('./cache');
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  it('initializes cache on first write without broadcasting', () => {
    const buf = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"]}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Alice"}'),
    );
    sync.processDbWrite(buf, 'client-a');

    expect(cache.cacheInitialized).toBe(true);
    expect(cache.hashCache.size).toBe(2);
    expect(clientA._sent).toHaveLength(0);
    expect(clientB._sent).toHaveLength(0);
  });

  it('broadcasts changed character block to non-sender clients', () => {
    // Init
    const root = '{"__directory":["char1"],"saveTime":1}';
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', root),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Alice"}'),
    ), 'client-a');

    // Change character
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', root),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Alice Updated"}'),
    ), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs).toHaveLength(1);

    const msg = bMsgs[0] as { type: string; changed: { name: string }[] };
    expect(msg.type).toBe('blocks-changed');
    expect(msg.changed).toHaveLength(1);
    expect(msg.changed[0].name).toBe('char1');

    // Sender gets version-update, not blocks-changed
    const aMsgs = sentMessages(clientA);
    expect(aMsgs).toHaveLength(1);
    expect((aMsgs[0] as { type: string }).type).toBe('version-update');
  });

  it('broadcasts ROOT change with synced changedKeys', () => {
    // Init
    const root1 = JSON.stringify({ __directory: [], saveTime: 1, temperature: 0.7, apiType: 'openai' });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');

    // Change synced key (temperature)
    const root2 = JSON.stringify({ __directory: [], saveTime: 2, temperature: 0.9, apiType: 'openai' });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);

    const msg = bMsgs[0] as { changed: { changedKeys?: string[] }[] };
    expect(msg.changed[0].changedKeys).toContain('temperature');
    expect(msg.changed[0].changedKeys).not.toContain('saveTime');
  });

  it('does not broadcast when only IGNORED root keys changed', () => {
    const root1 = JSON.stringify({ __directory: [], saveTime: 1, temperature: 0.7 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');

    // Only saveTime changed (IGNORED key)
    const root2 = JSON.stringify({ __directory: [], saveTime: 2, temperature: 0.7 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    expect(clientB._sent).toHaveLength(0);
  });

  it('marks hasUnknownKeys when non-synced, non-ignored keys change', () => {
    const root1 = JSON.stringify({ __directory: [], saveTime: 1, brandNewFeature: 'v1' });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');

    const root2 = JSON.stringify({ __directory: [], saveTime: 2, brandNewFeature: 'v2' });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
    const msg = bMsgs[0] as { changed: { hasUnknownKeys?: boolean }[] };
    expect(msg.changed[0].hasUnknownKeys).toBe(true);
  });

  it('detects character addition via __directory change', () => {
    const root1 = JSON.stringify({ __directory: ['char1'], saveTime: 1 });
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', root1),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"A"}'),
    ), 'client-a');

    // Add char2 to directory (without char2 data block — incremental save)
    const root2 = JSON.stringify({ __directory: ['char1', 'char2'], saveTime: 2 });
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', root2),
    ), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);

    const msg = bMsgs[0] as { added: { name: string; type: number }[] };
    expect(msg.added).toHaveLength(1);
    expect(msg.added[0].name).toBe('char2');
    expect(msg.added[0].type).toBe(BLOCK_TYPE.WITHOUT_CHAT);
  });

  it('detects character deletion via sender __directory change', () => {
    // Init with 2 characters
    const root1 = JSON.stringify({ __directory: ['char1', 'char2'], saveTime: 1 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');

    // Second write to establish clientRootCache
    const root2 = JSON.stringify({ __directory: ['char1', 'char2'], saveTime: 2 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');
    clearSent(clientA);
    clearSent(clientB);

    // Third write: char2 removed
    const root3 = JSON.stringify({ __directory: ['char1'], saveTime: 3 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root3)), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
    const msg = bMsgs[0] as { deleted: string[] };
    expect(msg.deleted).toContain('char2');
  });

  it('per-client intersection prevents echoing pre-existing state differences', () => {
    // Init
    const root0 = JSON.stringify({ __directory: [], temperature: 0.7, maxContext: 4096, saveTime: 1 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root0)), 'client-a');

    // Simulate WS init → establish per-client ROOT cache
    sync.initClientRootCache('client-a');
    sync.initClientRootCache('client-b');

    // Client B changes temperature → global cache now has temp=0.9
    const root1 = JSON.stringify({ __directory: [], temperature: 0.9, maxContext: 4096, saveTime: 2 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-b');
    clearSent(clientA);
    clearSent(clientB);

    // Client A (still has temp=0.7 locally) writes maxContext change
    const root2 = JSON.stringify({ __directory: [], temperature: 0.7, maxContext: 8192, saveTime: 3 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);

    const msg = bMsgs[0] as { changed: { changedKeys?: string[] | null }[] };
    // Only maxContext should be broadcast — temperature is a pre-existing diff, not a user change
    expect(msg.changed[0].changedKeys).toContain('maxContext');
    expect(msg.changed[0].changedKeys).not.toContain('temperature');
  });

  it('falls back to db-changed broadcast on invalid binary', () => {
    // Need init first so the fallback path is reached
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', '{}')), null);

    sync.processDbWrite(Buffer.from('garbage data'), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
    expect((bMsgs[0] as { type: string }).type).toBe('db-changed');
  });

  it('does not broadcast when hash is unchanged (dedup)', () => {
    const root = '{"__directory":[],"saveTime":1}';
    const buf = buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root));
    sync.processDbWrite(buf, 'client-a');  // init

    // Same data again
    sync.processDbWrite(buf, 'client-a');

    expect(clientB._sent).toHaveLength(0);
  });
});

// ─── processRemoteBlockWrite ───────────────────────────────────────

describe('processRemoteBlockWrite', () => {
  let cache: typeof import('./cache');
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  it('caches but does not broadcast before cache init', () => {
    const data = Buffer.from(JSON.stringify({ name: 'Alice' }));
    sync.processRemoteBlockWrite(data, 'char1', 'client-a');

    expect(cache.hashCache.has('char1')).toBe(true);
    expect(clientB._sent).toHaveLength(0);
  });

  it('broadcasts when character block changes after init', () => {
    // Init cache first
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"]}'),
    ), null);

    const data = Buffer.from(JSON.stringify({ name: 'Alice' }));
    sync.processRemoteBlockWrite(data, 'char1', 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
    const msg = bMsgs[0] as { type: string; added: { name: string }[] };
    expect(msg.type).toBe('blocks-changed');
  });

  it('skips invalid JSON', () => {
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":[]}'),
    ), null);

    sync.processRemoteBlockWrite(Buffer.from('not json{{{'), 'char1', 'client-a');
    expect(clientB._sent).toHaveLength(0);
  });

  it('deduplicates by hash', () => {
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"]}'),
    ), null);

    const data = Buffer.from(JSON.stringify({ name: 'Alice' }));
    sync.processRemoteBlockWrite(data, 'char1', 'client-a');
    clearSent(clientB);

    // Same data again → no broadcast
    sync.processRemoteBlockWrite(data, 'char1', 'client-a');
    expect(clientB._sent).toHaveLength(0);
  });
});

// ─── clientRootCache TTL ───────────────────────────────────────────

describe('clientRootCache cleanup', () => {
  let cache: typeof import('./cache');
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    cache = await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves cache for quick reconnection', () => {
    // Init cache + write to populate clientRootCache
    const root1 = JSON.stringify({ __directory: ['char1', 'char2'], saveTime: 1 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');
    sync.initClientRootCache('client-a');

    const root2 = JSON.stringify({ __directory: ['char1', 'char2'], saveTime: 2 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    // Disconnect
    sync.removeClientCache('client-a');

    // 1 minute later: reconnect (within 10-min TTL)
    vi.advanceTimersByTime(60_000);
    sync.initClientRootCache('client-a');

    // Cache should still work — delete detection uses sender's old root
    clearSent(clientA);
    clearSent(clientB);
    const root3 = JSON.stringify({ __directory: ['char1'], saveTime: 3 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root3)), 'client-a');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
    const msg = bMsgs[0] as { deleted: string[] };
    expect(msg.deleted).toContain('char2');
  });

  it('cleans up stale entries after TTL expires', () => {
    // Init + write
    const root1 = JSON.stringify({ __directory: ['char1'], saveTime: 1 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root1)), 'client-a');
    sync.initClientRootCache('client-a');

    const root2 = JSON.stringify({ __directory: ['char1'], saveTime: 2, temperature: 0.7 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root2)), 'client-a');

    // Disconnect client-a
    sync.removeClientCache('client-a');

    // Advance past TTL (10 min) + cleanup interval (1 min)
    vi.advanceTimersByTime(11 * 60_000);

    // New client with same name connects — should get fresh cache from global, not the old one
    sync.initClientRootCache('client-a');

    // Write with temperature change — should broadcast via global diff fallback
    clearSent(clientA);
    clearSent(clientB);
    const root3 = JSON.stringify({ __directory: ['char1'], saveTime: 3, temperature: 0.9 });
    sync.processDbWrite(buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', root3)), 'client-a');

    // The point: no crash, no stale data — per-client cache was cleaned
    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThan(0);
  });
});

// ─── Streaming ─────────────────────────────────────────────────────

describe('streaming', () => {
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  it('createStream broadcasts stream-start to non-sender', () => {
    sync.createStream('s1', 'client-a', 'char1');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs).toHaveLength(1);
    const msg = bMsgs[0] as { type: string; streamId: string; targetCharId: string | null };
    expect(msg.type).toBe('stream-start');
    expect(msg.streamId).toBe('s1');
    expect(msg.targetCharId).toBe('char1');

    expect(clientA._sent).toHaveLength(0);

    sync.endStream('s1');
  });

  it('parses OpenAI SSE format and flushes on end', () => {
    sync.createStream('s1', 'client-a', 'char1');
    clearSent(clientB);

    const chunk = Buffer.from(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
    );
    sync.processStreamChunk('s1', chunk);
    clearSent(clientB);

    sync.endStream('s1');

    const bMsgs = sentMessages(clientB);
    // endStream sends: stream-data (flush) + stream-end
    expect(bMsgs.length).toBeGreaterThanOrEqual(1);

    const dataMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-data') as
      { type: string; text: string } | undefined;
    if (dataMsg) {
      expect(dataMsg.text).toBe('Hello world');
    }

    const endMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-end');
    expect(endMsg).toBeDefined();
  });

  it('parses Anthropic SSE format', () => {
    sync.createStream('s2', 'client-a', 'char1');
    clearSent(clientB);

    const chunk = Buffer.from(
      'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n' +
      'data: {"type":"content_block_delta","delta":{"text":" world"}}\n',
    );
    sync.processStreamChunk('s2', chunk);
    clearSent(clientB);

    sync.endStream('s2');

    const bMsgs = sentMessages(clientB);
    const dataMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-data') as
      { type: string; text: string } | undefined;
    if (dataMsg) {
      expect(dataMsg.text).toBe('Hello world');
    }
  });

  it('ignores [DONE] markers', () => {
    sync.createStream('s3', 'client-a', 'char1');
    clearSent(clientB);

    const chunk = Buffer.from(
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n' +
      'data: [DONE]\n',
    );
    sync.processStreamChunk('s3', chunk);
    clearSent(clientB);

    sync.endStream('s3');

    const bMsgs = sentMessages(clientB);
    const dataMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-data') as
      { type: string; text: string } | undefined;
    if (dataMsg) {
      expect(dataMsg.text).toBe('Hi');
    }
  });

  it('endStream broadcasts text and targetCharId', () => {
    sync.createStream('s1', 'client-a', 'char1');
    clearSent(clientB);

    const chunk = Buffer.from(
      'data: {"choices":[{"delta":{"content":"Final text"}}]}\n',
    );
    sync.processStreamChunk('s1', chunk);
    clearSent(clientB);

    sync.endStream('s1');

    const bMsgs = sentMessages(clientB);
    const endMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-end') as
      { type: string; streamId: string; targetCharId: string | null; text: string } | undefined;
    expect(endMsg).toBeDefined();
    expect(endMsg!.targetCharId).toBe('char1');
    expect(endMsg!.text).toBe('Final text');
  });

  it('endStream is no-op for unknown stream ID', () => {
    expect(() => sync.endStream('nonexistent')).not.toThrow();
  });

  it('findActiveStreamForChar finds active stream', () => {
    sync.createStream('s1', 'client-a', 'char1');

    expect(sync.findActiveStreamForChar('char1')).not.toBeNull();
    expect(sync.findActiveStreamForChar('char2')).toBeNull();
    expect(sync.findActiveStreamForChar(null)).toBeNull();

    sync.endStream('s1');
    expect(sync.findActiveStreamForChar('char1')).toBeNull();
  });

  it('isWriteBlockedByStream blocks other clients during stream', () => {
    expect(sync.isWriteBlockedByStream('client-b')).toBe(false);

    sync.createStream('s1', 'client-a', 'char1');

    // client-b is blocked because client-a is streaming
    expect(sync.isWriteBlockedByStream('client-b')).toBe(true);
    // client-a (the streamer) is not blocked by its own stream
    expect(sync.isWriteBlockedByStream('client-a')).toBe(false);

    sync.endStream('s1');
    expect(sync.isWriteBlockedByStream('client-b')).toBe(false);
  });
});

// ─── broadcastResponseCompleted (non-SSE parcel locker) ───────────

describe('broadcastResponseCompleted', () => {
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  it('broadcasts stream-end with text to non-sender', () => {
    sync.broadcastResponseCompleted('r1', 'client-a', 'char-1', 'Generated text');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs).toHaveLength(1);
    const msg = bMsgs[0] as { type: string; streamId: string; targetCharId: string | null; text: string };
    expect(msg.type).toBe('stream-end');
    expect(msg.streamId).toBe('r1');
    expect(msg.targetCharId).toBe('char-1');
    expect(msg.text).toBe('Generated text');

    expect(clientA._sent).toHaveLength(0);
  });

  it('does not broadcast when text is empty', () => {
    sync.broadcastResponseCompleted('r1', 'client-a', 'char-1', '');
    expect(clientB._sent).toHaveLength(0);
  });

  it('handles null targetCharId', () => {
    sync.broadcastResponseCompleted('r1', 'client-a', null, 'Some text');

    const bMsgs = sentMessages(clientB);
    expect(bMsgs).toHaveLength(1);
    const msg = bMsgs[0] as { type: string; targetCharId: string | null };
    expect(msg.targetCharId).toBeNull();
  });
});

// ─── Write Order Queue Integration ────────────────────────────────

describe('write ordering (DB)', () => {
  let cache: typeof import('./cache');
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);

    // Init cache
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"],"saveTime":1}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Alice"}'),
    ), 'client-a');
    clearSent(clientA);
    clearSent(clientB);
  });

  it('processes out-of-order upstream responses in arrival order', () => {
    const seq1 = sync.reserveDbWrite();
    const seq2 = sync.reserveDbWrite();

    const buf1 = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"],"saveTime":2}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Bob"}'),
    );
    const buf2 = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"],"saveTime":3}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Charlie"}'),
    );

    // seq2 response arrives first
    sync.enqueueDbWrite(seq2, buf2, 'client-a');
    expect(clientB._sent).toHaveLength(0); // blocked, waiting for seq1

    // seq1 response arrives — both drain in order
    sync.enqueueDbWrite(seq1, buf1, 'client-a');

    // Cache should have Charlie (seq2, the newer data)
    expect(cache.dataCache.get('char1')).toBe('{"name":"Charlie"}');

    // Client B should have received 2 broadcasts
    const bMsgs = sentMessages(clientB);
    expect(bMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it('skip unblocks subsequent writes', () => {
    const seq1 = sync.reserveDbWrite();
    const seq2 = sync.reserveDbWrite();

    const buf2 = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"],"saveTime":3}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"Charlie"}'),
    );

    // seq2 arrives, seq1 failed
    sync.enqueueDbWrite(seq2, buf2, 'client-a');
    expect(clientB._sent).toHaveLength(0);

    sync.skipDbWrite(seq1);

    // Now seq2 should process
    expect(cache.dataCache.get('char1')).toBe('{"name":"Charlie"}');
    expect(sentMessages(clientB).length).toBeGreaterThan(0);
  });
});

describe('write ordering (remote block)', () => {
  let cache: typeof import('./cache');
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);

    // Init cache
    sync.processDbWrite(buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', '{"__directory":["char1"]}'),
    ), null);
  });

  it('processes out-of-order remote writes in arrival order', () => {
    const seq1 = sync.reserveRemoteWrite('char1');
    const seq2 = sync.reserveRemoteWrite('char1');

    const buf1 = Buffer.from(JSON.stringify({ name: 'Bob' }));
    const buf2 = Buffer.from(JSON.stringify({ name: 'Charlie' }));

    // seq2 arrives first
    sync.enqueueRemoteWrite(seq2, 'char1', buf2, 'client-a');
    expect(clientB._sent).toHaveLength(0);

    // seq1 arrives — both drain
    sync.enqueueRemoteWrite(seq1, 'char1', buf1, 'client-a');

    // Cache should have Charlie (newer)
    expect(cache.dataCache.get('char1')).toBe(JSON.stringify({ name: 'Charlie' }));
  });

  it('different charIds have independent queues', () => {
    const seqA = sync.reserveRemoteWrite('charA');
    const seqB = sync.reserveRemoteWrite('charB');

    const bufA = Buffer.from(JSON.stringify({ name: 'Alice' }));
    const bufB = Buffer.from(JSON.stringify({ name: 'Bob' }));

    // charB arrives — should process immediately (independent queue)
    sync.enqueueRemoteWrite(seqB, 'charB', bufB, 'client-a');
    expect(cache.dataCache.get('charB')).toBe(JSON.stringify({ name: 'Bob' }));

    // charA arrives
    sync.enqueueRemoteWrite(seqA, 'charA', bufA, 'client-a');
    expect(cache.dataCache.get('charA')).toBe(JSON.stringify({ name: 'Alice' }));
  });
});

// ─── Zombie stream cleanup ────────────────────────────────────────

describe('zombie stream cleanup', () => {
  let sync: typeof import('./sync');
  let clientA: ReturnType<typeof createMockWs>;
  let clientB: ReturnType<typeof createMockWs>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    await import('./cache');
    sync = await import('./sync');

    const serverState = await import('./serverState');
    serverState.clients.clear();
    clientA = createMockWs();
    clientB = createMockWs();
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-a', clientA);
    // @ts-expect-error partial WebSocket mock
    serverState.clients.set('client-b', clientB);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cleans up streams older than 30 minutes', () => {
    sync.createStream('s1', 'client-a', 'char1');
    clearSent(clientA);
    clearSent(clientB);

    // Stream should still be active before TTL
    expect(sync.findActiveStreamForChar('char1')).not.toBeNull();
    expect(sync.isWriteBlockedByStream('client-b')).toBe(true);

    // Advance past TTL (30 min) + cleanup interval (1 min)
    vi.advanceTimersByTime(31 * 60_000);

    // Stream should be cleaned up — endStream broadcasts stream-end
    expect(sync.findActiveStreamForChar('char1')).toBeNull();
    expect(sync.isWriteBlockedByStream('client-b')).toBe(false);

    // Verify stream-end was broadcast to non-sender
    const bMsgs = sentMessages(clientB);
    const endMsg = bMsgs.find((m) => (m as { type: string }).type === 'stream-end');
    expect(endMsg).toBeDefined();
  });

  it('does not clean up streams within TTL', () => {
    sync.createStream('s1', 'client-a', 'char1');
    clearSent(clientB);

    // 20 minutes — still within TTL
    vi.advanceTimersByTime(20 * 60_000);

    expect(sync.findActiveStreamForChar('char1')).not.toBeNull();
    expect(sync.isWriteBlockedByStream('client-b')).toBe(true);

    sync.endStream('s1');
  });
});
