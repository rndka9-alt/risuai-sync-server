import { describe, it, expect } from 'vitest';
import { streamParseRisuSave, encodeRawBlock } from './streamParseRisuSave';
import { BLOCK_TYPE } from '../../../shared/blockTypes';
import zlib from 'zlib';

const MAGIC = Buffer.from('RISUSAVE\0', 'utf-8');

function encodeBlock(type: number, compression: number, name: string, data: Buffer): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  const header = Buffer.alloc(3 + nameBytes.length + 4);
  header[0] = type;
  header[1] = compression;
  header[2] = nameBytes.length;
  nameBytes.copy(header, 3);
  header.writeUInt32LE(data.length, 3 + nameBytes.length);
  return Buffer.concat([header, data]);
}

function buildBinary(blocks: Array<{ type: number; name: string; data: string; compress?: boolean }>): Buffer {
  const parts = [MAGIC];
  for (const b of blocks) {
    let data = Buffer.from(b.data, 'utf-8');
    const compression = b.compress ? 1 : 0;
    if (b.compress) data = zlib.gzipSync(data);
    parts.push(encodeBlock(b.type, compression, b.name, data));
  }
  return Buffer.concat(parts);
}

async function* chunked(buf: Buffer, chunkSize: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += chunkSize) {
    yield buf.subarray(i, Math.min(i + chunkSize, buf.length));
  }
}

async function collectBlocks(input: AsyncIterable<Uint8Array>) {
  const blocks = [];
  for await (const block of streamParseRisuSave(input)) {
    blocks.push(block);
  }
  return blocks;
}

describe('streamParseRisuSave', () => {
  it('빈 바이너리 → 블록 없음', async () => {
    const blocks = await collectBlocks(chunked(MAGIC, 64));
    expect(blocks).toHaveLength(0);
  });

  it('단일 비압축 블록 파싱', async () => {
    const json = JSON.stringify({ hello: 'world' });
    const binary = buildBinary([{ type: BLOCK_TYPE.ROOT, name: 'root', data: json }]);
    const blocks = await collectBlocks(chunked(binary, 1024));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe(BLOCK_TYPE.ROOT);
    expect(blocks[0].name).toBe('root');
    expect(blocks[0].data.toString('utf-8')).toBe(json);
    expect(blocks[0].compression).toBe(0);
    expect(blocks[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('압축 블록 해제', async () => {
    const json = JSON.stringify({ compressed: true });
    const binary = buildBinary([{ type: BLOCK_TYPE.CONFIG, name: 'config', data: json, compress: true }]);
    const blocks = await collectBlocks(chunked(binary, 64));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.toString('utf-8')).toBe(json);
    expect(blocks[0].compression).toBe(1);
    // rawData는 압축된 상태
    expect(blocks[0].rawData.length).not.toBe(blocks[0].data.length);
  });

  it('여러 블록 순서대로 파싱', async () => {
    const binary = buildBinary([
      { type: BLOCK_TYPE.ROOT, name: 'root', data: '{"a":1}' },
      { type: BLOCK_TYPE.CONFIG, name: 'config', data: '{"b":2}' },
      { type: BLOCK_TYPE.PRESET, name: 'preset', data: '{"c":3}' },
    ]);
    const blocks = await collectBlocks(chunked(binary, 32));

    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.name)).toEqual(['root', 'config', 'preset']);
  });

  it('매우 작은 청크 (1바이트)로도 파싱', async () => {
    const binary = buildBinary([{ type: BLOCK_TYPE.ROOT, name: 'root', data: '{"tiny":true}' }]);
    const blocks = await collectBlocks(chunked(binary, 1));

    expect(blocks).toHaveLength(1);
    expect(blocks[0].data.toString('utf-8')).toBe('{"tiny":true}');
  });

  it('REMOTE 블록도 yield', async () => {
    const binary = buildBinary([
      { type: BLOCK_TYPE.ROOT, name: 'root', data: '{}' },
      { type: BLOCK_TYPE.REMOTE, name: 'char1', data: '{"id":"char1"}' },
    ]);
    const blocks = await collectBlocks(chunked(binary, 64));

    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe(BLOCK_TYPE.REMOTE);
    expect(blocks[1].name).toBe('char1');
  });
});

describe('encodeRawBlock', () => {
  it('파싱된 블록을 원본 형식으로 재인코딩', async () => {
    const json = '{"test":true}';
    const binary = buildBinary([{ type: BLOCK_TYPE.CONFIG, name: 'cfg', data: json }]);
    const blocks = await collectBlocks(chunked(binary, 1024));

    const raw = encodeRawBlock(blocks[0]);
    // MAGIC 이후의 블록 바이트와 일치해야 함
    const expectedRaw = binary.subarray(MAGIC.length);
    expect(raw.equals(expectedRaw)).toBe(true);
  });

  it('압축 블록도 원본 보존', async () => {
    const json = '{"compressed":"yes"}';
    const binary = buildBinary([{ type: BLOCK_TYPE.ROOT, name: 'root', data: json, compress: true }]);
    const blocks = await collectBlocks(chunked(binary, 1024));

    const raw = encodeRawBlock(blocks[0]);
    const expectedRaw = binary.subarray(MAGIC.length);
    expect(raw.equals(expectedRaw)).toBe(true);
  });
});
