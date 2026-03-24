import { describe, it, expect, beforeEach } from 'vitest';
import { computeDelta, computeRemoteDelta, warmCache } from './deltaDb';

const te = new TextEncoder();

// --- RisuSave 바이너리 빌더 ---

function buildBlock(type: number, name: string, json: string): Uint8Array {
  const nameBytes = te.encode(name);
  const dataBytes = te.encode(json);
  const buf = new Uint8Array(2 + 1 + nameBytes.length + 4 + dataBytes.length);
  let offset = 0;
  buf[offset++] = type;
  buf[offset++] = 0; // no compression
  buf[offset++] = nameBytes.length;
  buf.set(nameBytes, offset); offset += nameBytes.length;
  new DataView(buf.buffer).setUint32(offset, dataBytes.length, true); offset += 4;
  buf.set(dataBytes, offset);
  return buf;
}

function buildRisuSave(blocks: Uint8Array[]): Uint8Array {
  const magic = te.encode('RISUSAVE\0');
  let totalLen = magic.length;
  for (const b of blocks) totalLen += b.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  result.set(magic, offset); offset += magic.length;
  for (const b of blocks) { result.set(b, offset); offset += b.length; }
  return result;
}

describe('computeDelta (database.bin)', () => {
  beforeEach(() => {
    // 캐시 리셋: 빈 save로 warm
    warmCache(buildRisuSave([]));
  });

  it('새 블록 추가 시 전체 값으로 delta 생성', () => {
    // warm으로 root만 있는 캐시 설정
    warmCache(buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ temperature: 0.7 })),
    ]));

    // config 블록 추가
    const save = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ temperature: 0.7 })),
      buildBlock(0, 'config', JSON.stringify({ version: 1 })),
    ]);
    const delta = computeDelta(save);
    expect(delta).not.toBeNull();
    expect(delta!.blocks['config'].patch).toEqual({ version: 1 });
    expect(delta!.blocks['root']).toBeUndefined(); // 변경 없음
  });

  it('변경 없으면 null 반환', () => {
    const save = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ temperature: 0.7 })),
    ]);
    computeDelta(save);
    expect(computeDelta(save)).toBeNull();
  });

  it('변경된 키만 delta로 추출', () => {
    const save1 = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ temperature: 0.7, maxContext: 4096 })),
    ]);
    computeDelta(save1);

    const save2 = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ temperature: 0.9, maxContext: 4096 })),
    ]);
    const delta = computeDelta(save2);
    expect(delta).not.toBeNull();
    expect(delta!.blocks['root'].patch).toEqual({ temperature: 0.9 });
  });

  it('삭제된 키는 null로 표시', () => {
    const save1 = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ a: 1, b: 2 })),
    ]);
    computeDelta(save1);

    const save2 = buildRisuSave([
      buildBlock(1, 'root', JSON.stringify({ a: 1 })),
    ]);
    const delta = computeDelta(save2);
    expect(delta!.blocks['root'].patch).toEqual({ b: null });
  });
});

describe('computeRemoteDelta', () => {
  it('첫 호출은 캐시만 채우고 null 반환', () => {
    const body = te.encode(JSON.stringify({ name: 'Alice', chatPage: 0 }));
    expect(computeRemoteDelta('char-1', body)).toBeNull();
  });

  it('변경 없으면 null 반환', () => {
    const obj = { name: 'Alice', chatPage: 0 };
    computeRemoteDelta('char-2', te.encode(JSON.stringify(obj)));
    expect(computeRemoteDelta('char-2', te.encode(JSON.stringify(obj)))).toBeNull();
  });

  it('변경된 키만 delta로 추출', () => {
    const obj1 = { name: 'Alice', chatPage: 0, desc: 'old' };
    computeRemoteDelta('char-3', te.encode(JSON.stringify(obj1)));

    const obj2 = { name: 'Alice', chatPage: 1, desc: 'old' };
    const delta = computeRemoteDelta('char-3', te.encode(JSON.stringify(obj2)));

    expect(delta).not.toBeNull();
    expect(delta!.blocks['char-3']).toEqual({
      type: 2, // WITH_CHAT
      patch: { chatPage: 1 },
    });
  });

  it('배열은 전체 교체로 처리', () => {
    const obj1 = { name: 'Alice', chats: [{ message: ['hello'] }] };
    computeRemoteDelta('char-4', te.encode(JSON.stringify(obj1)));

    const obj2 = { name: 'Alice', chats: [{ message: ['hello', 'world'] }] };
    const delta = computeRemoteDelta('char-4', te.encode(JSON.stringify(obj2)));

    expect(delta).not.toBeNull();
    // chats는 배열이므로 전체 교체, 그 안의 message도 배열이므로 전체 교체
    expect(delta!.blocks['char-4'].patch).toEqual({
      chats: [{ message: ['hello', 'world'] }],
    });
  });

  it('삭제된 키는 null로 표시', () => {
    const obj1 = { name: 'Alice', tags: ['test'], notes: 'some' };
    computeRemoteDelta('char-5', te.encode(JSON.stringify(obj1)));

    const obj2 = { name: 'Alice', tags: ['test'] };
    const delta = computeRemoteDelta('char-5', te.encode(JSON.stringify(obj2)));

    expect(delta!.blocks['char-5'].patch).toEqual({ notes: null });
  });

  it('charId별로 캐시가 독립', () => {
    computeRemoteDelta('char-a', te.encode(JSON.stringify({ name: 'A' })));
    computeRemoteDelta('char-b', te.encode(JSON.stringify({ name: 'B' })));

    const deltaA = computeRemoteDelta('char-a', te.encode(JSON.stringify({ name: 'A2' })));
    const deltaB = computeRemoteDelta('char-b', te.encode(JSON.stringify({ name: 'B' })));

    expect(deltaA).not.toBeNull();
    expect(deltaA!.blocks['char-a'].patch).toEqual({ name: 'A2' });
    expect(deltaB).toBeNull();
  });

  it('유효하지 않은 JSON은 null 반환', () => {
    expect(computeRemoteDelta('char-x', te.encode('not-json'))).toBeNull();
  });
});
