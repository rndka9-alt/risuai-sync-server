import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BLOCK_TYPE } from '../shared/blockTypes';
import { buildBlock, buildRisuSave } from './test-helpers';

vi.mock('./config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),

  DB_PATH: 'database/database.bin',
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

describe('parseRisuSaveBlocks', () => {
  let parseRisuSaveBlocks: typeof import('./parser').parseRisuSaveBlocks;

  beforeEach(async () => {
    vi.resetModules();
    const parser = await import('./parser');
    parseRisuSaveBlocks = parser.parseRisuSaveBlocks;
  });

  it('returns null for empty buffer', () => {
    expect(parseRisuSaveBlocks(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for buffer shorter than magic header', () => {
    expect(parseRisuSaveBlocks(Buffer.from('RISU'))).toBeNull();
  });

  it('returns null for invalid magic header', () => {
    expect(parseRisuSaveBlocks(Buffer.from('NOTVALID\0'))).toBeNull();
  });

  it('parses save with no blocks (header only)', () => {
    const result = parseRisuSaveBlocks(Buffer.from('RISUSAVE\0', 'utf-8'));
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.blocks.size).toBe(0);
    expect(result.directory).toEqual([]);
  });

  it('parses single uncompressed block', () => {
    const json = JSON.stringify({ name: 'test' });
    const buf = buildRisuSave(buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', json));

    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.blocks.size).toBe(1);
    const parsed = result.blocks.get('char1');
    if (!parsed) { expect.unreachable('block not found'); return; }

    expect(parsed.type).toBe(BLOCK_TYPE.WITH_CHAT);
    expect(parsed.json).toBe(json);
    expect(parsed.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('parses multiple blocks', () => {
    const buf = buildRisuSave(
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"A"}'),
      buildBlock(BLOCK_TYPE.WITHOUT_CHAT, 'char2', '{"name":"B"}'),
    );

    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.blocks.size).toBe(2);
    expect(result.blocks.has('char1')).toBe(true);
    expect(result.blocks.has('char2')).toBe(true);
  });

  it('skips REMOTE blocks', () => {
    const buf = buildRisuSave(
      buildBlock(BLOCK_TYPE.REMOTE, 'remote1', '{"meta":true}'),
      buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"name":"A"}'),
    );

    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.blocks.size).toBe(1);
    expect(result.blocks.has('remote1')).toBe(false);
    expect(result.blocks.has('char1')).toBe(true);
  });

  it('extracts __directory from ROOT block', () => {
    const rootJson = JSON.stringify({ __directory: ['char1', 'char2', 'char3'] });
    const buf = buildRisuSave(buildBlock(BLOCK_TYPE.ROOT, 'root', rootJson));

    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.directory).toEqual(['char1', 'char2', 'char3']);
  });

  it('parses zlib-compressed blocks', () => {
    const json = JSON.stringify({ compressed: true, data: 'hello world' });
    const buf = buildRisuSave(buildBlock(BLOCK_TYPE.WITH_CHAT, 'comp1', json, true));

    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    const parsed = result.blocks.get('comp1');
    if (!parsed) { expect.unreachable('block not found'); return; }

    expect(parsed.json).toBe(json);
  });

  it('produces consistent hashes for same data', () => {
    const block = buildBlock(BLOCK_TYPE.CONFIG, 'cfg', '{"stable":true}');
    const r1 = parseRisuSaveBlocks(buildRisuSave(block));
    const r2 = parseRisuSaveBlocks(buildRisuSave(block));
    if (!r1 || !r2) { expect.unreachable('expected non-null'); return; }

    expect(r1.blocks.get('cfg')?.hash).toBe(r2.blocks.get('cfg')?.hash);
  });

  it('produces different hashes for different data', () => {
    const r1 = parseRisuSaveBlocks(buildRisuSave(buildBlock(BLOCK_TYPE.CONFIG, 'cfg', '{"v":1}')));
    const r2 = parseRisuSaveBlocks(buildRisuSave(buildBlock(BLOCK_TYPE.CONFIG, 'cfg', '{"v":2}')));
    if (!r1 || !r2) { expect.unreachable('expected non-null'); return; }

    expect(r1.blocks.get('cfg')?.hash).not.toBe(r2.blocks.get('cfg')?.hash);
  });

  it('handles truncated block data gracefully', () => {
    const buf = buildRisuSave(buildBlock(BLOCK_TYPE.WITH_CHAT, 'char1', '{"ok":true}'));
    const truncated = buf.subarray(0, buf.length - 5);

    const result = parseRisuSaveBlocks(truncated);
    expect(result).not.toBeNull();
  });

  it('returns empty blocks when remaining bytes are too short for a block header', () => {
    const buf = Buffer.concat([Buffer.from('RISUSAVE\0'), Buffer.alloc(3)]);
    const result = parseRisuSaveBlocks(buf);
    if (!result) { expect.unreachable('expected non-null'); return; }

    expect(result.blocks.size).toBe(0);
  });
});
