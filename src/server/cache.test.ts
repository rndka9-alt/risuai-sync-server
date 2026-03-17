import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BLOCK_TYPE } from '../shared/blockTypes';

vi.mock('./config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),
  SYNC_TOKEN: 'test-token',
  DB_PATH: 'database/database.bin',
  MAX_CACHE_SIZE: 200,
  MAX_LOG_ENTRIES: 5,
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

describe('dataCache (SizedCache)', () => {
  let cache: typeof import('./cache');

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
  });

  it('stores and retrieves values', () => {
    cache.dataCache.set('key1', '{"hello":"world"}');
    expect(cache.dataCache.get('key1')).toBe('{"hello":"world"}');
  });

  it('returns null for missing keys', () => {
    expect(cache.dataCache.get('nonexistent')).toBeNull();
  });

  it('deletes entries', () => {
    cache.dataCache.set('key1', 'value');
    cache.dataCache.delete('key1');
    expect(cache.dataCache.get('key1')).toBeNull();
  });

  it('tracks size', () => {
    expect(cache.dataCache.size).toBe(0);
    cache.dataCache.set('a', 'x');
    cache.dataCache.set('b', 'y');
    expect(cache.dataCache.size).toBe(2);
  });

  it('evicts oldest entry when size limit exceeded', () => {
    // MAX_CACHE_SIZE = 200 bytes
    cache.dataCache.set('a', 'x'.repeat(80));  // 80
    cache.dataCache.set('b', 'y'.repeat(80));  // 160
    cache.dataCache.set('c', 'z'.repeat(80));  // 240 > 200 → evict 'a'

    expect(cache.dataCache.get('a')).toBeNull();
    expect(cache.dataCache.get('b')).not.toBeNull();
    expect(cache.dataCache.get('c')).not.toBeNull();
  });

  it('LRU: accessing an entry moves it to the back of eviction queue', () => {
    cache.dataCache.set('a', 'x'.repeat(80));  // 80
    cache.dataCache.set('b', 'y'.repeat(80));  // 160
    cache.dataCache.get('a');                    // 'a' is now most recent
    cache.dataCache.set('c', 'z'.repeat(80));  // 240 > 200 → evict 'b' (oldest)

    expect(cache.dataCache.get('a')).not.toBeNull();
    expect(cache.dataCache.get('b')).toBeNull();
    expect(cache.dataCache.get('c')).not.toBeNull();
  });

  it('rejects entries larger than max size', () => {
    cache.dataCache.set('huge', 'x'.repeat(300));
    expect(cache.dataCache.get('huge')).toBeNull();
    expect(cache.dataCache.size).toBe(0);
  });

  it('updates existing entry in place without double-counting size', () => {
    cache.dataCache.set('a', 'x'.repeat(80));
    cache.dataCache.set('a', 'y'.repeat(80));  // update, not add
    cache.dataCache.set('b', 'z'.repeat(80));  // should fit (80+80 = 160 < 200)

    expect(cache.dataCache.get('a')).toBe('y'.repeat(80));
    expect(cache.dataCache.get('b')).not.toBeNull();
  });
});

describe('hashCache', () => {
  let cache: typeof import('./cache');

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
  });

  it('is a standard Map', () => {
    cache.hashCache.set('block1', { type: BLOCK_TYPE.ROOT, hash: 'abc123' });
    expect(cache.hashCache.get('block1')?.hash).toBe('abc123');
    expect(cache.hashCache.size).toBe(1);
  });
});

describe('changeLog', () => {
  let cache: typeof import('./cache');

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
  });

  it('starts at version 0', () => {
    expect(cache.currentVersion).toBe(0);
  });

  it('increments version on each entry', () => {
    cache.addChangeLogEntry([{ name: 'a', type: BLOCK_TYPE.WITH_CHAT }], []);
    expect(cache.currentVersion).toBe(1);

    cache.addChangeLogEntry([{ name: 'b', type: BLOCK_TYPE.WITH_CHAT }], []);
    expect(cache.currentVersion).toBe(2);
  });

  it('returns the new version number', () => {
    const v = cache.addChangeLogEntry([{ name: 'a', type: BLOCK_TYPE.ROOT }], []);
    expect(v).toBe(1);
  });

  it('trims old entries when exceeding MAX_LOG_ENTRIES', () => {
    // MAX_LOG_ENTRIES = 5
    for (let i = 0; i < 7; i++) {
      cache.addChangeLogEntry([{ name: `block${i}`, type: BLOCK_TYPE.WITH_CHAT }], []);
    }
    // Versions 1-7 created, but only 5 retained (3-7)
    const expired = cache.getChangesSince(2);
    expect(expired.status).toBe(410);

    const valid = cache.getChangesSince(3);
    expect(valid.status).toBe(200);
  });
});

describe('getChangesSince', () => {
  let cache: typeof import('./cache');

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./cache');
  });

  it('returns empty changes when up to date', () => {
    cache.addChangeLogEntry([{ name: 'a', type: BLOCK_TYPE.ROOT }], []);

    const result = cache.getChangesSince(1);
    expect(result.status).toBe(200);
    if (!('changes' in result.data)) { expect.unreachable(); return; }
    expect(result.data.changes).toHaveLength(0);
  });

  it('returns changes after the given version', () => {
    cache.addChangeLogEntry([{ name: 'a', type: BLOCK_TYPE.ROOT }], [], 'client-a');
    cache.addChangeLogEntry([{ name: 'b', type: BLOCK_TYPE.WITH_CHAT }], [], 'client-b');

    const result = cache.getChangesSince(0);
    expect(result.status).toBe(200);
    if (!('changes' in result.data)) { expect.unreachable(); return; }
    expect(result.data.changes).toHaveLength(2);
  });

  it('returns 410 when requested version is expired', () => {
    for (let i = 0; i < 6; i++) {
      cache.addChangeLogEntry([{ name: `b${i}`, type: BLOCK_TYPE.WITH_CHAT }], []);
    }
    // MAX_LOG_ENTRIES=5, versions 1-6, retained 2-6
    const result = cache.getChangesSince(1);
    expect(result.status).toBe(410);
  });

  it('excludes changes from specified client', () => {
    cache.addChangeLogEntry([{ name: 'a', type: BLOCK_TYPE.WITH_CHAT }], [], 'client-a');
    cache.addChangeLogEntry([{ name: 'b', type: BLOCK_TYPE.WITH_CHAT }], [], 'client-b');

    const result = cache.getChangesSince(0, 'client-a');
    expect(result.status).toBe(200);
    if (!('changes' in result.data)) { expect.unreachable(); return; }
    expect(result.data.changes).toHaveLength(1);
    expect(result.data.changes[0].changed[0].name).toBe('b');
  });

  it('returns empty changes when log is empty', () => {
    const result = cache.getChangesSince(0);
    expect(result.status).toBe(200);
    if (!('changes' in result.data)) { expect.unreachable(); return; }
    expect(result.data.changes).toHaveLength(0);
  });

  it('includes epoch and version in response', () => {
    cache.addChangeLogEntry([], ['deleted-block']);
    const result = cache.getChangesSince(0);

    expect(result.data.epoch).toEqual(expect.any(Number));
    expect(result.data.version).toBe(1);
  });
});
