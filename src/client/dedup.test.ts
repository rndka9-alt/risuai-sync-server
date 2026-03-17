import { describe, it, expect, beforeEach, vi } from 'vitest';

function hexEncode(str: string): string {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

describe('extractRemoteCharId', () => {
  let extractRemoteCharId: typeof import('./dedup').extractRemoteCharId;

  beforeEach(async () => {
    vi.resetModules();
    ({ extractRemoteCharId } = await import('./dedup'));
  });

  it('plain object 헤더에서 charId 추출', () => {
    const headers = { 'file-path': hexEncode('remotes/abc-123.local.bin') };
    expect(extractRemoteCharId(headers)).toBe('abc-123');
  });

  it('Headers 객체에서 charId 추출', () => {
    const headers = new Headers({ 'file-path': hexEncode('remotes/char-xyz.local.bin') });
    expect(extractRemoteCharId(headers)).toBe('char-xyz');
  });

  it('배열 헤더에서 charId 추출', () => {
    const headers: [string, string][] = [['file-path', hexEncode('remotes/id-999.local.bin')]];
    expect(extractRemoteCharId(headers)).toBe('id-999');
  });

  it('대소문자 무관하게 헤더 매칭', () => {
    const headers = { 'File-Path': hexEncode('remotes/mixed-case.local.bin') };
    expect(extractRemoteCharId(headers)).toBe('mixed-case');
  });

  it('database.bin 경로면 null 반환', () => {
    const headers = { 'file-path': hexEncode('database/database.bin') };
    expect(extractRemoteCharId(headers)).toBeNull();
  });

  it('file-path 헤더 없으면 null 반환', () => {
    expect(extractRemoteCharId({})).toBeNull();
  });

  it('잘못된 hex면 null 반환', () => {
    const headers = { 'file-path': 'not-valid-hex-gg' };
    expect(extractRemoteCharId(headers)).toBeNull();
  });

  it('슬래시 포함된 charId 추출', () => {
    const headers = { 'file-path': hexEncode('remotes/deep/nested/id.local.bin') };
    expect(extractRemoteCharId(headers)).toBe('deep/nested/id');
  });
});

describe('isUnchangedRemoteBlock', () => {
  let isUnchangedRemoteBlock: typeof import('./dedup').isUnchangedRemoteBlock;

  beforeEach(async () => {
    vi.resetModules();
    ({ isUnchangedRemoteBlock } = await import('./dedup'));
  });

  it('첫 write는 false (캐시 없음)', async () => {
    const body = new TextEncoder().encode('{"name":"Alice"}');
    expect(await isUnchangedRemoteBlock('char-1', body)).toBe(false);
  });

  it('동일 데이터 재전송 시 true (dedup)', async () => {
    const body = new TextEncoder().encode('{"name":"Alice"}');
    await isUnchangedRemoteBlock('char-1', body);
    expect(await isUnchangedRemoteBlock('char-1', body)).toBe(true);
  });

  it('데이터 변경 시 false', async () => {
    const body1 = new TextEncoder().encode('{"name":"Alice"}');
    const body2 = new TextEncoder().encode('{"name":"Alice","lastInteraction":123}');
    await isUnchangedRemoteBlock('char-1', body1);
    expect(await isUnchangedRemoteBlock('char-1', body2)).toBe(false);
  });

  it('변경 후 동일 데이터면 다시 true', async () => {
    const body1 = new TextEncoder().encode('v1');
    const body2 = new TextEncoder().encode('v2');
    await isUnchangedRemoteBlock('char-1', body1);
    await isUnchangedRemoteBlock('char-1', body2);
    expect(await isUnchangedRemoteBlock('char-1', body2)).toBe(true);
  });

  it('다른 charId는 별도 캐시', async () => {
    const body = new TextEncoder().encode('same-data');
    await isUnchangedRemoteBlock('char-1', body);
    expect(await isUnchangedRemoteBlock('char-2', body)).toBe(false);
  });

  it('빈 body도 정상 처리', async () => {
    const body = new Uint8Array(0);
    expect(await isUnchangedRemoteBlock('char-1', body)).toBe(false);
    expect(await isUnchangedRemoteBlock('char-1', body)).toBe(true);
  });
});

describe('ensureBufferedBody', () => {
  let ensureBufferedBody: typeof import('./dedup').ensureBufferedBody;

  beforeEach(async () => {
    vi.resetModules();
    ({ ensureBufferedBody } = await import('./dedup'));
  });

  it('Uint8Array body는 그대로 통과', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const init: RequestInit = { method: 'POST', body };
    const result = await ensureBufferedBody(init);
    expect(result).toBe(init);
  });

  it('null body는 그대로 통과', async () => {
    const init: RequestInit = { method: 'POST', body: null };
    const result = await ensureBufferedBody(init);
    expect(result).toBe(init);
  });

  it('string body는 그대로 통과', async () => {
    const init: RequestInit = { method: 'POST', body: 'hello' };
    const result = await ensureBufferedBody(init);
    expect(result).toBe(init);
  });

  it('ReadableStream body를 Uint8Array로 변환', async () => {
    const data = new TextEncoder().encode('stream-content');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    const init: RequestInit = { method: 'POST', body: stream };
    const result = await ensureBufferedBody(init);
    expect(result.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.body as Uint8Array)).toBe('stream-content');
  });

  it('멀티 청크 ReadableStream 병합', async () => {
    const chunk1 = new TextEncoder().encode('hello-');
    const chunk2 = new TextEncoder().encode('world');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });
    const init: RequestInit = { method: 'POST', body: stream };
    const result = await ensureBufferedBody(init);
    expect(new TextDecoder().decode(result.body as Uint8Array)).toBe('hello-world');
  });

  it('다른 RequestInit 속성 보존', async () => {
    const stream = new ReadableStream({
      start(controller) { controller.close(); },
    });
    const init: RequestInit = {
      method: 'POST',
      body: stream,
      headers: { 'x-test': 'value' },
    };
    const result = await ensureBufferedBody(init);
    expect(result.method).toBe('POST');
    expect((result.headers as Record<string, string>)['x-test']).toBe('value');
    expect(result).not.toBe(init);
  });
});
