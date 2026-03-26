import { describe, it, expect } from 'vitest';
import { parseBatchBody } from './parseBatchBody';

function buildPayload(files: Array<{ filePath: string; body: Buffer }>): Buffer {
  const header = JSON.stringify({
    files: files.map((f) => ({ filePath: f.filePath, size: f.body.length })),
  });
  const headerBuf = Buffer.from(header, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([lenBuf, headerBuf, ...files.map((f) => f.body)]);
}

describe('parseBatchBody', () => {
  it('파일 1개 파싱', () => {
    const body = Buffer.from('hello');
    const buf = buildPayload([{ filePath: 'aabb', body }]);
    const result = parseBatchBody(buf);

    expect(result).not.toBeNull();
    expect(result!.header.files).toHaveLength(1);
    expect(result!.header.files[0].filePath).toBe('aabb');
    expect(result!.header.files[0].size).toBe(5);
    expect(result!.bodies[0].toString()).toBe('hello');
  });

  it('파일 여러 개 파싱', () => {
    const files = [
      { filePath: 'aa', body: Buffer.from('one') },
      { filePath: 'bb', body: Buffer.from('two!!') },
      { filePath: 'cc', body: Buffer.from('') },
    ];
    const buf = buildPayload(files);
    const result = parseBatchBody(buf);

    expect(result).not.toBeNull();
    expect(result!.header.files).toHaveLength(3);
    expect(result!.bodies[0].toString()).toBe('one');
    expect(result!.bodies[1].toString()).toBe('two!!');
    expect(result!.bodies[2].toString()).toBe('');
  });

  it('빈 버퍼 → null', () => {
    expect(parseBatchBody(Buffer.alloc(0))).toBeNull();
  });

  it('4바이트 미만 → null', () => {
    expect(parseBatchBody(Buffer.from([0, 0, 1]))).toBeNull();
  });

  it('헤더 길이가 실제보다 크면 null', () => {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(9999, 0);
    expect(parseBatchBody(lenBuf)).toBeNull();
  });

  it('JSON 파싱 실패 → null', () => {
    const bad = Buffer.from('not json');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(bad.length, 0);
    expect(parseBatchBody(Buffer.concat([lenBuf, bad]))).toBeNull();
  });

  it('본문 바이트가 선언보다 부족하면 null', () => {
    const header = JSON.stringify({ files: [{ filePath: 'aa', size: 100 }] });
    const headerBuf = Buffer.from(header, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(headerBuf.length, 0);
    const body = Buffer.from('short');
    expect(parseBatchBody(Buffer.concat([lenBuf, headerBuf, body]))).toBeNull();
  });

  it('files가 없는 JSON → null', () => {
    const header = JSON.stringify({ notFiles: [] });
    const headerBuf = Buffer.from(header, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(headerBuf.length, 0);
    expect(parseBatchBody(Buffer.concat([lenBuf, headerBuf]))).toBeNull();
  });

  it('filePath가 문자열이 아니면 null', () => {
    const header = JSON.stringify({ files: [{ filePath: 123, size: 0 }] });
    const headerBuf = Buffer.from(header, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(headerBuf.length, 0);
    expect(parseBatchBody(Buffer.concat([lenBuf, headerBuf]))).toBeNull();
  });
});
