import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),
  SYNC_TOKEN: 'test-token',
  DB_PATH: 'database/database.bin',
  MAX_CACHE_SIZE: 200,
  MAX_LOG_ENTRIES: 5,
  LOG_LEVEL: 'error',
  SCRIPT_TAG: '',
}));

vi.mock('../../logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  diffObjects: vi.fn(),
  isDebug: false,
}));

describe('mergeRemoteBlock', () => {
  let cache: typeof import('../../cache');
  let mergeRemoteBlock: typeof import('./mergeRemoteBlock').mergeRemoteBlock;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('../../cache');
    const mod = await import('./mergeRemoteBlock');
    mergeRemoteBlock = mod.mergeRemoteBlock;
  });

  it('returns null when no cached data exists', () => {
    const incoming = Buffer.from(JSON.stringify({ chats: [], chatPage: 0 }));
    expect(mergeRemoteBlock('char1', incoming)).toBeNull();
  });

  it('returns null when cached data is not valid JSON', () => {
    cache.dataCache.set('char1', 'not-json{{{');
    const incoming = Buffer.from(JSON.stringify({ chats: [], chatPage: 0 }));
    expect(mergeRemoteBlock('char1', incoming)).toBeNull();
  });

  it('returns null when incoming buffer is not valid JSON', () => {
    cache.dataCache.set('char1', JSON.stringify({ chats: [], chatPage: 0 }));
    expect(mergeRemoteBlock('char1', Buffer.from('invalid'))).toBeNull();
  });

  it('returns null when data has no chats array', () => {
    cache.dataCache.set('char1', JSON.stringify({ noChats: true }));
    const incoming = Buffer.from(JSON.stringify({ noChats: true }));
    expect(mergeRemoteBlock('char1', incoming)).toBeNull();
  });

  it('returns null when merge result equals incoming (no change)', () => {
    const data = { chats: [{ id: 'c1', name: 'Test', message: [{ role: 'user', data: 'hi' }] }], chatPage: 0 };
    cache.dataCache.set('char1', JSON.stringify(data));
    const incoming = Buffer.from(JSON.stringify(data));
    expect(mergeRemoteBlock('char1', incoming)).toBeNull();
  });

  it('returns merged buffer when stale data is missing messages', () => {
    const server = {
      chats: [{
        id: 'c1',
        name: 'Test',
        message: [
          { role: 'user', data: 'hi', chatId: 'a' },
          { role: 'char', data: 'hello', chatId: 'b' },
          { role: 'user', data: 'new', chatId: 'c' },
        ],
      }],
      chatPage: 0,
    };
    const incoming = {
      chats: [{
        id: 'c1',
        name: 'Test',
        message: [
          { role: 'user', data: 'hi', chatId: 'a' },
          { role: 'char', data: 'hello', chatId: 'b' },
        ],
      }],
      chatPage: 0,
    };

    cache.dataCache.set('char1', JSON.stringify(server));
    const result = mergeRemoteBlock('char1', Buffer.from(JSON.stringify(incoming)));

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.toString('utf-8'));
    expect(parsed.chats[0].message).toHaveLength(3);
    expect(parsed.chats[0].message[2].chatId).toBe('c');
  });

  it('preserves server-only chats', () => {
    const server = {
      chats: [
        { id: 'c1', name: 'Chat 1', message: [{ role: 'user', data: 'hi' }] },
        { id: 'c2', name: 'Chat 2', message: [{ role: 'user', data: 'hello' }] },
      ],
      chatPage: 0,
    };
    const incoming = {
      chats: [
        { id: 'c1', name: 'Chat 1', message: [{ role: 'user', data: 'hi' }] },
      ],
      chatPage: 0,
    };

    cache.dataCache.set('char1', JSON.stringify(server));
    const result = mergeRemoteBlock('char1', Buffer.from(JSON.stringify(incoming)));

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!.toString('utf-8'));
    expect(parsed.chats).toHaveLength(2);
  });
});
