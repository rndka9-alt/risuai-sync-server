import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BLOCK_TYPE } from '../shared/blockTypes';
import type { BlockChange } from '../shared/types';
import type { StreamState } from './state';

// sync.ts가 import하는 모듈 mock
vi.mock('./config', () => ({
  CLIENT_ID: 'test-client',
  syncFetch: vi.fn(),
}));
vi.mock('./state', () => ({
  state: { activeStreams: new Map(), lastVersion: 0, epoch: 0 },
}));
vi.mock('./notification', () => ({
  showNotification: vi.fn(),
}));

function makeStreamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    streamId: 'stream-1',
    targetCharId: null,
    targetCharIndex: -1,
    targetChatIndex: -1,
    targetMsgIndex: -1,
    resolved: false,
    lastText: '',
    ...overrides,
  };
}

function makeDb(characters: Record<string, unknown>[] = []) {
  return { characters } as { characters: Record<string, unknown>[]; [key: string]: unknown };
}

function makeChar(chaId: string, overrides: Record<string, unknown> = {}) {
  return {
    chaId,
    chatPage: 0,
    chats: [{ message: [{ role: 'char', data: 'hello' }], isStreaming: false }],
    ...overrides,
  };
}

// ─── isRootSafeChange ──────────────────────────────────────────────

describe('isRootSafeChange', () => {
  let isRootSafeChange: typeof import('./sync').isRootSafeChange;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    isRootSafeChange = mod.isRootSafeChange;
  });

  it('returns true for ROOT with all synced keys', () => {
    const block: BlockChange = {
      name: 'root',
      type: BLOCK_TYPE.ROOT,
      changedKeys: ['temperature', 'maxContext'],
      hasUnknownKeys: false,
    };
    expect(isRootSafeChange(block)).toBe(true);
  });

  it('returns false when changedKeys is null', () => {
    const block: BlockChange = {
      name: 'root',
      type: BLOCK_TYPE.ROOT,
      changedKeys: null,
    };
    expect(isRootSafeChange(block)).toBe(false);
  });

  it('returns false when changedKeys is empty', () => {
    const block: BlockChange = {
      name: 'root',
      type: BLOCK_TYPE.ROOT,
      changedKeys: [],
      hasUnknownKeys: false,
    };
    expect(isRootSafeChange(block)).toBe(false);
  });

  it('returns false when hasUnknownKeys is true', () => {
    const block: BlockChange = {
      name: 'root',
      type: BLOCK_TYPE.ROOT,
      changedKeys: ['temperature'],
      hasUnknownKeys: true,
    };
    expect(isRootSafeChange(block)).toBe(false);
  });

  it('returns false when changedKeys contains non-synced key', () => {
    const block: BlockChange = {
      name: 'root',
      type: BLOCK_TYPE.ROOT,
      changedKeys: ['temperature', 'totallyMadeUpKey'],
      hasUnknownKeys: false,
    };
    expect(isRootSafeChange(block)).toBe(false);
  });
});

// ─── classifyChangedBlocks ─────────────────────────────────────────

describe('classifyChangedBlocks', () => {
  let classifyChangedBlocks: typeof import('./sync').classifyChangedBlocks;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    classifyChangedBlocks = mod.classifyChangedBlocks;
  });

  it('classifies WITH_CHAT and WITHOUT_CHAT as charBlocks', () => {
    const changed: BlockChange[] = [
      { name: 'char-1', type: BLOCK_TYPE.WITH_CHAT },
      { name: 'char-2', type: BLOCK_TYPE.WITHOUT_CHAT },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.charBlocks).toHaveLength(2);
    expect(result.safeRootBlocks).toHaveLength(0);
    expect(result.needsReload).toBe(false);
  });

  it('classifies safe ROOT with plugin-writable keys as safeRootBlocks', () => {
    const changed: BlockChange[] = [
      { name: 'root', type: BLOCK_TYPE.ROOT, changedKeys: ['temperature', 'maxContext'], hasUnknownKeys: false },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.safeRootBlocks).toHaveLength(1);
    expect(result.needsReload).toBe(false);
  });

  it('sets needsReload for safe ROOT with non-plugin-writable keys', () => {
    // openAIKey is SYNCED but not in PLUGIN_WRITABLE_KEYS
    const changed: BlockChange[] = [
      { name: 'root', type: BLOCK_TYPE.ROOT, changedKeys: ['openAIKey'], hasUnknownKeys: false },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.safeRootBlocks).toHaveLength(0);
    expect(result.needsReload).toBe(true);
  });

  it('sets needsReload for unsafe ROOT (hasUnknownKeys)', () => {
    const changed: BlockChange[] = [
      { name: 'root', type: BLOCK_TYPE.ROOT, changedKeys: ['temperature'], hasUnknownKeys: true },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.safeRootBlocks).toHaveLength(0);
    expect(result.needsReload).toBe(true);
  });

  it('ignores CONFIG, BOTPRESET, MODULES (no reload, no classify)', () => {
    const changed: BlockChange[] = [
      { name: 'config', type: BLOCK_TYPE.CONFIG },
      { name: 'preset', type: BLOCK_TYPE.BOTPRESET },
      { name: 'mod', type: BLOCK_TYPE.MODULES },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.charBlocks).toHaveLength(0);
    expect(result.safeRootBlocks).toHaveLength(0);
    expect(result.needsReload).toBe(false);
  });

  it('sets needsReload for unknown block types', () => {
    const changed: BlockChange[] = [
      { name: 'unknown', type: BLOCK_TYPE.REMOTE },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.needsReload).toBe(true);
  });

  it('handles mixed blocks correctly', () => {
    const changed: BlockChange[] = [
      { name: 'char-1', type: BLOCK_TYPE.WITH_CHAT },
      { name: 'root', type: BLOCK_TYPE.ROOT, changedKeys: ['temperature'], hasUnknownKeys: false },
      { name: 'config', type: BLOCK_TYPE.CONFIG },
    ];
    const result = classifyChangedBlocks(changed);
    expect(result.charBlocks).toHaveLength(1);
    expect(result.safeRootBlocks).toHaveLength(1);
    expect(result.needsReload).toBe(false);
  });

  it('returns empty results for empty input', () => {
    const result = classifyChangedBlocks([]);
    expect(result.charBlocks).toHaveLength(0);
    expect(result.safeRootBlocks).toHaveLength(0);
    expect(result.needsReload).toBe(false);
  });
});

// ─── applyRootSafeKeys ────────────────────────────────────────────

describe('applyRootSafeKeys', () => {
  let applyRootSafeKeys: typeof import('./sync').applyRootSafeKeys;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    applyRootSafeKeys = mod.applyRootSafeKeys;
  });

  it('copies specified keys from rootData to db', () => {
    const db = makeDb();
    db.temperature = 0.5;
    const rootData = { temperature: 0.8, maxContext: 4096 };
    applyRootSafeKeys(db, rootData, ['temperature', 'maxContext']);
    expect(db.temperature).toBe(0.8);
    expect(db.maxContext).toBe(4096);
  });

  it('skips keys not present in rootData', () => {
    const db = makeDb();
    db.temperature = 0.5;
    applyRootSafeKeys(db, {}, ['temperature']);
    expect(db.temperature).toBe(0.5);
  });

  it('handles empty keys array', () => {
    const db = makeDb();
    applyRootSafeKeys(db, { temperature: 0.8 }, []);
    expect(db.temperature).toBeUndefined();
  });
});

// ─── resolveStreamTarget ──────────────────────────────────────────

describe('resolveStreamTarget', () => {
  let resolveStreamTarget: typeof import('./sync').resolveStreamTarget;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    resolveStreamTarget = mod.resolveStreamTarget;
  });

  it('resolves when target character exists with last char message', () => {
    const stream = makeStreamState({ targetCharId: 'char-1' });
    const db = makeDb([makeChar('char-1')]);
    expect(resolveStreamTarget(stream, db)).toBe(true);
    expect(stream.resolved).toBe(true);
    expect(stream.targetCharIndex).toBe(0);
    expect(stream.targetChatIndex).toBe(0);
    expect(stream.targetMsgIndex).toBe(0);
  });

  it('creates placeholder AI message when last message is not char role', () => {
    const db = makeDb([makeChar('char-1', {
      chats: [{ message: [{ role: 'user', data: 'hi' }], isStreaming: false }],
    })]);
    const stream = makeStreamState({ targetCharId: 'char-1' });
    expect(resolveStreamTarget(stream, db)).toBe(true);
    const chats = (db.characters[0] as Record<string, unknown>).chats as Array<{ message: Array<Record<string, unknown>> }>;
    expect(chats[0].message).toHaveLength(2);
    expect(chats[0].message[1].role).toBe('char');
    expect(stream.targetMsgIndex).toBe(1);
  });

  it('returns false when targetCharId is null', () => {
    const stream = makeStreamState({ targetCharId: null });
    const db = makeDb([makeChar('char-1')]);
    expect(resolveStreamTarget(stream, db)).toBe(false);
  });

  it('returns false when character not found', () => {
    const stream = makeStreamState({ targetCharId: 'nonexistent' });
    const db = makeDb([makeChar('char-1')]);
    expect(resolveStreamTarget(stream, db)).toBe(false);
  });

  it('returns true immediately if already resolved', () => {
    const stream = makeStreamState({ resolved: true });
    expect(resolveStreamTarget(stream, makeDb())).toBe(true);
  });

  it('sets isStreaming on the target chat', () => {
    const db = makeDb([makeChar('char-1')]);
    const stream = makeStreamState({ targetCharId: 'char-1' });
    resolveStreamTarget(stream, db);
    const chats = (db.characters[0] as Record<string, unknown>).chats as Array<{ isStreaming: boolean }>;
    expect(chats[0].isStreaming).toBe(true);
  });
});

// ─── resolveStreamFromDb ──────────────────────────────────────────

describe('resolveStreamFromDb', () => {
  let resolveStreamFromDb: typeof import('./sync').resolveStreamFromDb;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    resolveStreamFromDb = mod.resolveStreamFromDb;
  });

  it('finds character with isStreaming=true', () => {
    const db = makeDb([
      makeChar('char-1', { chats: [{ message: [{ role: 'char', data: '' }], isStreaming: false }] }),
      makeChar('char-2', { chats: [{ message: [{ role: 'char', data: '' }], isStreaming: true }] }),
    ]);
    const stream = makeStreamState();
    expect(resolveStreamFromDb(stream, db)).toBe(true);
    expect(stream.targetCharId).toBe('char-2');
    expect(stream.targetCharIndex).toBe(1);
    expect(stream.resolved).toBe(true);
  });

  it('returns false when no character is streaming', () => {
    const db = makeDb([makeChar('char-1')]);
    const stream = makeStreamState();
    expect(resolveStreamFromDb(stream, db)).toBe(false);
    expect(stream.resolved).toBe(false);
  });

  it('returns true immediately if already resolved', () => {
    const stream = makeStreamState({ resolved: true });
    expect(resolveStreamFromDb(stream, makeDb())).toBe(true);
  });

  it('handles character with no chats', () => {
    const db = makeDb([makeChar('char-1', { chats: undefined })]);
    const stream = makeStreamState();
    expect(resolveStreamFromDb(stream, db)).toBe(false);
  });
});

// ─── applyStreamText ──────────────────────────────────────────────

describe('applyStreamText', () => {
  let applyStreamText: typeof import('./sync').applyStreamText;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./sync');
    applyStreamText = mod.applyStreamText;
  });

  it('applies lastText to the target message', () => {
    const db = makeDb([makeChar('char-1')]);
    const stream = makeStreamState({
      targetCharIndex: 0,
      targetChatIndex: 0,
      targetMsgIndex: 0,
      lastText: 'updated text',
      resolved: true,
    });
    applyStreamText(stream, db);
    const chats = (db.characters[0] as Record<string, unknown>).chats as Array<{ message: Array<Record<string, unknown>> }>;
    expect(chats[0].message[0].data).toBe('updated text');
  });

  it('increments reloadKeys on the character', () => {
    const db = makeDb([makeChar('char-1', { reloadKeys: 5 })]);
    const stream = makeStreamState({
      targetCharIndex: 0,
      targetChatIndex: 0,
      targetMsgIndex: 0,
      lastText: 'text',
      resolved: true,
    });
    applyStreamText(stream, db);
    expect((db.characters[0] as Record<string, unknown>).reloadKeys).toBe(6);
  });

  it('does nothing when character index is out of bounds', () => {
    const db = makeDb([]);
    const stream = makeStreamState({
      targetCharIndex: 99,
      targetChatIndex: 0,
      targetMsgIndex: 0,
      lastText: 'text',
    });
    // Should not throw
    applyStreamText(stream, db);
  });

  it('does nothing when message index is out of bounds', () => {
    const db = makeDb([makeChar('char-1')]);
    const stream = makeStreamState({
      targetCharIndex: 0,
      targetChatIndex: 0,
      targetMsgIndex: 99,
      lastText: 'text',
    });
    applyStreamText(stream, db);
    const chats = (db.characters[0] as Record<string, unknown>).chats as Array<{ message: Array<Record<string, unknown>> }>;
    // Original message unchanged
    expect(chats[0].message[0].data).toBe('hello');
  });
});
