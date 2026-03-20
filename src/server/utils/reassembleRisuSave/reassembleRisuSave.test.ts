import { describe, it, expect, vi } from 'vitest';
import { BLOCK_TYPE } from '../../../shared/blockTypes';

vi.mock('../../config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),
  DB_PATH: 'database/database.bin',
  MAX_CACHE_SIZE: 1048576,
  MAX_LOG_ENTRIES: 100,
  LOG_LEVEL: 'error',
  SCRIPT_TAG: '',
}));

import { reassembleRisuSave } from './reassembleRisuSave';
import { parseRisuSaveBlocks } from '../../parser';
import { buildBlock, buildRisuSave } from '../../test-helpers';

describe('reassembleRisuSave', () => {
  it('ROOT JSON 교체 후 재파싱하면 변경된 값을 반환한다', () => {
    const root = { foo: 'bar', plugins: [] };
    const original = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', JSON.stringify(root)),
    );

    const modified = { ...root, plugins: [{ name: 'test' }] };
    const result = reassembleRisuSave(original, JSON.stringify(modified));

    expect(result).not.toBeNull();
    const parsed = parseRisuSaveBlocks(result!);
    expect(parsed).not.toBeNull();
    const rootBlock = parsed!.blocks.get('root');
    expect(rootBlock).toBeDefined();
    expect(JSON.parse(rootBlock!.json)).toEqual(modified);
  });

  it('동일 JSON으로 재조립하면 파싱 결과가 동일하다', () => {
    const root = { hello: 'world' };
    const rootJson = JSON.stringify(root);
    const original = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', rootJson),
    );

    const result = reassembleRisuSave(original, rootJson);
    expect(result).not.toBeNull();

    const originalParsed = parseRisuSaveBlocks(original);
    const resultParsed = parseRisuSaveBlocks(result!);
    expect(resultParsed!.blocks.get('root')!.json).toBe(
      originalParsed!.blocks.get('root')!.json,
    );
  });

  it('압축된 ROOT 블록을 처리한다', () => {
    const root = { compressed: true };
    const original = buildRisuSave(
      buildBlock(BLOCK_TYPE.ROOT, 'root', JSON.stringify(root), true),
    );

    const modified = { compressed: true, added: 'field' };
    const result = reassembleRisuSave(original, JSON.stringify(modified));

    expect(result).not.toBeNull();
    const parsed = parseRisuSaveBlocks(result!);
    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.blocks.get('root')!.json)).toEqual(modified);
  });

  it('비-ROOT 블록을 보존한다', () => {
    const root = { plugins: [] };
    const config = { setting: 'value' };
    const original = buildRisuSave(
      buildBlock(BLOCK_TYPE.CONFIG, 'config', JSON.stringify(config)),
      buildBlock(BLOCK_TYPE.ROOT, 'root', JSON.stringify(root)),
      buildBlock(BLOCK_TYPE.MODULES, 'mod1', JSON.stringify({ id: 1 })),
    );

    const modified = { plugins: [{ name: 'new' }] };
    const result = reassembleRisuSave(original, JSON.stringify(modified));
    expect(result).not.toBeNull();

    const parsed = parseRisuSaveBlocks(result!);
    expect(parsed).not.toBeNull();
    expect(JSON.parse(parsed!.blocks.get('config')!.json)).toEqual(config);
    expect(JSON.parse(parsed!.blocks.get('root')!.json)).toEqual(modified);
    expect(JSON.parse(parsed!.blocks.get('mod1')!.json)).toEqual({ id: 1 });
  });

  it('잘못된 매직 헤더면 null을 반환한다', () => {
    expect(reassembleRisuSave(Buffer.from('INVALID'), '{}')).toBeNull();
  });

  it('빈 버퍼면 null을 반환한다', () => {
    expect(reassembleRisuSave(Buffer.alloc(0), '{}')).toBeNull();
  });
});
