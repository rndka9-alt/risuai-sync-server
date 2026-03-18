import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import { EventEmitter } from 'events';

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

function mockUpstreamReq(): http.ClientRequest {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { destroyed: false, destroy: vi.fn(() => { emitter.emit('close'); }) });
}

function openAIChunk(content: string): Buffer {
  return Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

function anthropicChunk(text: string): Buffer {
  return Buffer.from(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`);
}

// ─── Core lifecycle ─────────────────────────────────────────────

describe('stream-buffer lifecycle', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('create → addChunk → complete accumulates text', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', 'char-1', req);

    sb.addChunk('s1', openAIChunk('Hello'));
    sb.addChunk('s1', openAIChunk(' World'));
    sb.complete('s1');

    const streams = sb.getActiveStreams();
    expect(streams).toHaveLength(0); // completed → not active
  });

  it('accumulates OpenAI format deltas', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    sb.addChunk('s1', openAIChunk('Hello'));
    sb.addChunk('s1', openAIChunk(' World'));

    const streams = sb.getActiveStreams();
    expect(streams).toHaveLength(1);
    expect(streams[0].textLength).toBe(11); // "Hello World"
  });

  it('accumulates Anthropic format deltas', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    sb.addChunk('s1', anthropicChunk('Bonjour'));
    sb.addChunk('s1', anthropicChunk(' monde'));

    const streams = sb.getActiveStreams();
    expect(streams[0].textLength).toBe(13); // "Bonjour monde"
  });

  it('ignores chunks after complete', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('Before'));
    sb.complete('s1');
    sb.addChunk('s1', openAIChunk('After'));

    // Should not crash, and complete is idempotent
    expect(sb.getActiveStreams()).toHaveLength(0);
  });

  it('fail marks stream as failed', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('partial'));
    sb.fail('s1', 'connection reset');

    expect(sb.getActiveStreams()).toHaveLength(0);
    // fail after fail is no-op
    sb.fail('s1', 'again');
  });

  it('complete after fail is no-op', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.fail('s1', 'err');
    sb.complete('s1'); // should not throw or change status
  });
});

// ─── Abort ─────────────────────────────────────────────

describe('stream-buffer abort', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('abort destroys upstream request', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', 'char-1', req);
    sb.addChunk('s1', openAIChunk('partial'));

    const result = sb.abort('s1');
    expect(result).toBe(true);
    expect(req.destroy).toHaveBeenCalled();
  });

  it('abort returns false for unknown stream', () => {
    expect(sb.abort('nonexistent')).toBe(false);
  });

  it('abort returns false for already completed stream', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.complete('s1');
    expect(sb.abort('s1')).toBe(false);
  });

  it('fail after abort is no-op (no double processing)', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('text'));
    sb.abort('s1');
    sb.fail('s1', 'destroyed'); // triggered by upstream destroy — should be no-op
  });
});

// ─── Subscribe (reconnection) ─────────────────────────────────────────────

describe('stream-buffer subscribe', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  function mockRes() {
    const written: string[] = [];
    const emitter = new EventEmitter();
    const endFn = vi.fn();
    const res = Object.assign(emitter, {
      writeHead: vi.fn(),
      write: vi.fn((data: string) => { written.push(data); return true; }),
      end: endFn,
      writableEnded: false,
    });
    return { res: res as unknown as http.ServerResponse, written, endFn };
  }

  it('subscribe to active stream returns accumulated text', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('Hello'));

    const { res, written } = mockRes();
    const result = sb.subscribe('s1', res);
    expect(result).toBe(true);

    // First message: current accumulated text
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0].replace('data: ', '').trim());
    expect(parsed.text).toBe('Hello');
  });

  it('subscribe to completed stream gets text + done event', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('Final answer'));
    sb.complete('s1');

    const { res, written, endFn } = mockRes();
    sb.subscribe('s1', res);

    // Two messages: accumulated text + done event
    expect(written).toHaveLength(2);
    const doneEvent = JSON.parse(written[1].replace('data: ', '').trim());
    expect(doneEvent.type).toBe('done');
    expect(doneEvent.text).toBe('Final answer');
    expect(endFn).toHaveBeenCalled();
  });

  it('subscribe to failed stream gets text + error event', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('partial'));
    sb.fail('s1', 'upstream died');

    const { res, written, endFn } = mockRes();
    sb.subscribe('s1', res);

    const errorEvent = JSON.parse(written[1].replace('data: ', '').trim());
    expect(errorEvent.type).toBe('error');
    expect(errorEvent.error).toBe('upstream died');
    expect(errorEvent.text).toBe('partial');
    expect(endFn).toHaveBeenCalled();
  });

  it('subscriber receives live updates during streaming', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', openAIChunk('Hello'));

    const { res, written } = mockRes();
    sb.subscribe('s1', res);
    expect(written).toHaveLength(1); // initial snapshot

    // New chunk arrives
    sb.addChunk('s1', openAIChunk(' World'));

    // Subscriber gets updated accumulated text
    expect(written).toHaveLength(2);
    const update = JSON.parse(written[1].replace('data: ', '').trim());
    expect(update.text).toBe('Hello World');
  });

  it('subscriber receives done event when stream completes', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    const { res, written, endFn } = mockRes();
    sb.subscribe('s1', res);

    sb.addChunk('s1', openAIChunk('Done'));
    sb.complete('s1');

    const lastMsg = JSON.parse(written[written.length - 1].replace('data: ', '').trim());
    expect(lastMsg.type).toBe('done');
    expect(lastMsg.text).toBe('Done');
    expect(endFn).toHaveBeenCalled();
  });

  it('returns false for unknown stream', () => {
    const { res } = mockRes();
    expect(sb.subscribe('nonexistent', res)).toBe(false);
  });

  it('multiple subscribers receive same updates', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    const sub1 = mockRes();
    const sub2 = mockRes();
    sb.subscribe('s1', sub1.res);
    sb.subscribe('s1', sub2.res);

    sb.addChunk('s1', openAIChunk('shared'));

    // Both get the update (initial + live)
    expect(sub1.written).toHaveLength(2);
    expect(sub2.written).toHaveLength(2);
  });
});

// ─── storeResponse (non-SSE) ─────────────────────────────────────────────

describe('stream-buffer storeResponse', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  function mockRes() {
    const written: Buffer[] = [];
    const emitter = new EventEmitter();
    const endFn = vi.fn((body?: Buffer) => { if (body) written.push(body); });
    const writeHeadFn = vi.fn();
    const res = Object.assign(emitter, {
      writeHead: writeHeadFn,
      write: vi.fn((data: Buffer) => { written.push(data); return true; }),
      end: endFn,
      writableEnded: false,
    });
    return { res: res as unknown as http.ServerResponse, written, endFn, writeHeadFn };
  }

  it('stores and serves non-SSE response via subscribe', () => {
    const body = Buffer.from(JSON.stringify({ error: 'rate_limit_exceeded' }));
    const headers: http.IncomingHttpHeaders = { 'content-type': 'application/json' };
    sb.storeResponse('r1', 'client-a', 'char-1', 429, headers, body);

    const mock = mockRes();
    const result = sb.subscribe('r1', mock.res);
    expect(result).toBe(true);

    // Serves original status and headers
    expect(mock.writeHeadFn).toHaveBeenCalledWith(429, expect.objectContaining({
      'content-type': 'application/json',
      'content-length': String(body.length),
    }));

    // Serves original body
    expect(mock.endFn).toHaveBeenCalledWith(body);
  });

  it('stored response is immediately completed (not active)', () => {
    sb.storeResponse('r1', 'client-a', null, 200, {}, Buffer.from('ok'));
    expect(sb.getActiveStreams()).toHaveLength(0);
  });

  it('stored response cannot be aborted', () => {
    sb.storeResponse('r1', 'client-a', null, 200, {}, Buffer.from('ok'));
    expect(sb.abort('r1')).toBe(false);
  });

  it('removes transfer-encoding header on serve', () => {
    const headers: http.IncomingHttpHeaders = {
      'content-type': 'text/plain',
      'transfer-encoding': 'chunked',
    };
    sb.storeResponse('r1', 'client-a', null, 200, headers, Buffer.from('data'));

    const mock = mockRes();
    sb.subscribe('r1', mock.res);

    const calledHeaders = mock.writeHeadFn.mock.calls[0][1];
    expect(calledHeaders['transfer-encoding']).toBeUndefined();
    expect(calledHeaders['content-length']).toBe('4');
  });

  it('serves binary body correctly', () => {
    const binary = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37]);
    sb.storeResponse('r1', 'client-a', null, 200, { 'content-type': 'application/octet-stream' }, binary);

    const mock = mockRes();
    sb.subscribe('r1', mock.res);

    expect(mock.endFn).toHaveBeenCalledWith(binary);
  });
});

// ─── getActiveStreams ─────────────────────────────────────────────

describe('getActiveStreams', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('returns only streaming (not completed) streams', () => {
    sb.create('s1', 'client-a', 'char-1', mockUpstreamReq());
    sb.create('s2', 'client-b', 'char-2', mockUpstreamReq());
    sb.complete('s2');

    const active = sb.getActiveStreams();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('s1');
    expect(active[0].targetCharId).toBe('char-1');
  });

  it('returns empty array when no streams', () => {
    expect(sb.getActiveStreams()).toHaveLength(0);
  });
});

// ─── Parcel Locker (acknowledge & getCompletedPending) ────────────

describe('stream-buffer parcel locker', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('acknowledge removes a stream and returns true', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', 'char-1', req);
    sb.addChunk('s1', openAIChunk('Hello'));
    sb.complete('s1');

    expect(sb.acknowledge('s1')).toBe(true);
    // Gone — subscribe should fail
    const emitter = new EventEmitter();
    const res = Object.assign(emitter, {
      writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), writableEnded: false,
    });
    expect(sb.subscribe('s1', res as unknown as http.ServerResponse)).toBe(false);
  });

  it('acknowledge returns false for unknown ID', () => {
    expect(sb.acknowledge('nonexistent')).toBe(false);
  });

  it('getCompletedPending returns only completed SSE streams with text', () => {
    // completed with text → included
    sb.create('s1', 'client-a', 'char-1', mockUpstreamReq());
    sb.addChunk('s1', openAIChunk('result'));
    sb.complete('s1');

    // still streaming → excluded
    sb.create('s2', 'client-b', 'char-2', mockUpstreamReq());
    sb.addChunk('s2', openAIChunk('partial'));

    // failed → excluded
    sb.create('s3', 'client-c', 'char-3', mockUpstreamReq());
    sb.addChunk('s3', openAIChunk('err'));
    sb.fail('s3', 'upstream died');

    // non-SSE (no accumulatedText) → excluded
    sb.storeResponse('r1', 'client-d', 'char-4', 200, {}, Buffer.from('ok'));

    const pending = sb.getCompletedPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('s1');
    expect(pending[0].targetCharId).toBe('char-1');
    expect(pending[0].accumulatedText).toBe('result');
  });

  it('acknowledged stream is excluded from getCompletedPending', () => {
    sb.create('s1', 'client-a', 'char-1', mockUpstreamReq());
    sb.addChunk('s1', openAIChunk('text'));
    sb.complete('s1');

    sb.acknowledge('s1');

    expect(sb.getCompletedPending()).toHaveLength(0);
  });
});

// ─── Non-SSE parcel locker integration ────────────────────────────

describe('non-SSE parcel locker', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('storeResponse with valid JSON populates accumulatedText and appears in getCompletedPending', () => {
    const body = Buffer.from(JSON.stringify({
      choices: [{ message: { content: 'Generated text' } }],
    }));
    sb.storeResponse('r1', 'client-a', 'char-1', 200,
      { 'content-type': 'application/json' }, body);

    const pending = sb.getCompletedPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('r1');
    expect(pending[0].accumulatedText).toBe('Generated text');
  });

  it('storeResponse returns extracted text', () => {
    const body = Buffer.from(JSON.stringify({
      choices: [{ message: { content: 'Hello' } }],
    }));
    const result = sb.storeResponse('r1', 'client-a', 'char-1', 200,
      { 'content-type': 'application/json' }, body);
    expect(result).toBe('Hello');
  });

  it('storeResponse returns empty string for error responses', () => {
    const body = Buffer.from(JSON.stringify({ error: 'rate limit' }));
    const result = sb.storeResponse('r1', 'client-a', 'char-1', 429,
      { 'content-type': 'application/json' }, body);
    expect(result).toBe('');
  });
});

// ─── SSE delta parsing ─────────────────────────────────────────────

describe('SSE delta parsing edge cases', () => {
  let sb: typeof import('./stream-buffer');

  beforeEach(async () => {
    vi.resetModules();
    sb = await import('./stream-buffer');
    sb._clear();
  });

  it('handles [DONE] marker without crashing', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', Buffer.from('data: [DONE]\n\n'));

    expect(sb.getActiveStreams()[0].textLength).toBe(0);
  });

  it('handles incomplete line (no newline) — buffers until next chunk', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    // Partial line — no trailing newline
    sb.addChunk('s1', Buffer.from('data: {"choices":[{"delta":{"content":"He'));
    expect(sb.getActiveStreams()[0].textLength).toBe(0); // not parsed yet

    // Complete the line
    sb.addChunk('s1', Buffer.from('llo"}}]}\n\n'));
    expect(sb.getActiveStreams()[0].textLength).toBe(5); // "Hello"
  });

  it('handles mixed OpenAI and non-matching events', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);
    sb.addChunk('s1', Buffer.from('data: {"type":"ping"}\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));

    expect(sb.getActiveStreams()[0].textLength).toBe(2); // "ok"
  });

  it('processes remaining line buffer on complete', () => {
    const req = mockUpstreamReq();
    sb.create('s1', 'client-a', null, req);

    // Chunk without trailing newline
    sb.addChunk('s1', Buffer.from('data: {"choices":[{"delta":{"content":"tail"}}]}'));

    // Not parsed yet (no newline)
    expect(sb.getActiveStreams()[0].textLength).toBe(0);

    // Complete flushes the line buffer
    sb.complete('s1');

    // Verify via subscribe
    const written: string[] = [];
    const emitter = new EventEmitter();
    const res = Object.assign(emitter, {
      writeHead: vi.fn(),
      write: vi.fn((data: string) => { written.push(data); return true; }),
      end: vi.fn(),
      writableEnded: false,
    });
    sb.subscribe('s1', res as unknown as http.ServerResponse);

    const snapshot = JSON.parse(written[0].replace('data: ', '').trim());
    expect(snapshot.text).toBe('tail');
  });
});
