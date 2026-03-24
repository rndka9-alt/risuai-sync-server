import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { IncomingMessage } from 'http';

vi.mock('../../config', () => ({
  PORT: 3000,
  UPSTREAM: new URL('http://localhost:6001'),

  DB_PATH: 'database/database.bin',
  MAX_LOG_ENTRIES: 100,
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

function mockReq(headers: { [key: string]: string } = {}) {
  // @ts-expect-error partial IncomingMessage for testing
  const req: IncomingMessage = { method: 'POST', url: '/proxy2', headers };
  return req;
}

// ─── isPrivateHost ──────────────────────────────────────────────────

describe('isPrivateHost', () => {
  let isPrivateHost: typeof import('./index').isPrivateHost;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./index');
    isPrivateHost = mod.isPrivateHost;
  });

  // ─── 차단 대상 ─────────────────────────────────
  it.each([
    ['localhost', 'localhost'],
    ['sub.localhost', '.localhost suffix'],
    ['127.0.0.1', 'IPv4 loopback'],
    ['127.255.255.255', 'IPv4 loopback upper'],
    ['10.0.0.1', '10.0.0.0/8'],
    ['10.255.0.1', '10.0.0.0/8 upper'],
    ['172.16.0.1', '172.16.0.0/12 lower'],
    ['172.31.255.255', '172.16.0.0/12 upper'],
    ['192.168.0.1', '192.168.0.0/16'],
    ['192.168.255.255', '192.168.0.0/16 upper'],
    ['169.254.1.1', '169.254.0.0/16 link-local'],
    ['0.0.0.0', '0.0.0.0/8'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fc00::1', 'IPv6 unique local fc'],
    ['fd12:3456::1', 'IPv6 unique local fd'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped IPv6 loopback'],
    ['::ffff:10.0.0.1', 'IPv4-mapped IPv6 private'],
    ['::ffff:192.168.1.1', 'IPv4-mapped IPv6 private 192'],
  ])('blocks %s (%s)', (hostname) => {
    expect(isPrivateHost(hostname)).toBe(true);
  });

  // ─── 허용 대상 ─────────────────────────────────
  it.each([
    ['api.openai.com', 'public domain'],
    ['api.anthropic.com', 'public domain'],
    ['8.8.8.8', 'public IP'],
    ['172.15.0.1', 'below 172.16 range'],
    ['172.32.0.1', 'above 172.31 range'],
    ['169.253.0.1', 'not link-local'],
    ['192.167.1.1', 'not 192.168'],
    ['1.2.3.4', 'public IP'],
  ])('allows %s (%s)', (hostname) => {
    expect(isPrivateHost(hostname)).toBe(false);
  });
});

// ─── decodeProxy2Headers ─────────────────────────────────────────────

describe('decodeProxy2Headers', () => {
  let decodeProxy2Headers: typeof import('./index').decodeProxy2Headers;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./index');
    decodeProxy2Headers = mod.decodeProxy2Headers;
  });

  it('returns null when risu-url is missing', () => {
    expect(decodeProxy2Headers(mockReq())).toBeNull();
  });

  it('returns null when risu-url is empty string', () => {
    expect(decodeProxy2Headers(mockReq({ 'risu-url': '' }))).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(decodeProxy2Headers(mockReq({ 'risu-url': 'not-a-url' }))).toBeNull();
  });

  it('decodes risu-url to URL', () => {
    const url = 'https://api.openai.com/v1/chat/completions';
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent(url),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(result.targetUrl.href).toBe(url);
    expect(result.targetUrl.hostname).toBe('api.openai.com');
  });

  it('preserves URL path and query parameters', () => {
    const url = 'https://api.anthropic.com/v1/messages?beta=true';
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent(url),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(result.targetUrl.pathname).toBe('/v1/messages');
    expect(result.targetUrl.search).toBe('?beta=true');
  });

  it('returns empty headers when risu-header is absent', () => {
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent('https://api.example.com/v1'),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(Object.keys(result.headers)).toHaveLength(0);
  });

  it('decodes risu-header JSON to headers', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer sk-test',
    };
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent('https://api.example.com/v1'),
      'risu-header': encodeURIComponent(JSON.stringify(headers)),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['authorization']).toBe('Bearer sk-test');
  });

  it('only includes string values from risu-header', () => {
    const headers = {
      'content-type': 'application/json',
      'x-number': 42,
      'x-null': null,
      'x-bool': true,
    };
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent('https://api.example.com/v1'),
      'risu-header': encodeURIComponent(JSON.stringify(headers)),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-number']).toBeUndefined();
    expect(result.headers['x-null']).toBeUndefined();
    expect(result.headers['x-bool']).toBeUndefined();
  });

  it('returns null for malformed risu-header JSON', () => {
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent('https://api.example.com/v1'),
      'risu-header': 'not-valid-json',
    }));
    expect(result).toBeNull();
  });

  it('treats array risu-header as empty headers', () => {
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent('https://api.example.com/v1'),
      'risu-header': encodeURIComponent(JSON.stringify(['a', 'b'])),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(Object.keys(result.headers)).toHaveLength(0);
  });

  it('handles double-encoded URI components', () => {
    const url = 'https://api.example.com/v1?q=hello%20world';
    const result = decodeProxy2Headers(mockReq({
      'risu-url': encodeURIComponent(url),
    }));
    if (!result) { expect.unreachable('expected non-null'); return; }
    expect(result.targetUrl.search).toBe('?q=hello%20world');
  });
});

// ─── forwardToLlm ─────────────────────────────────────────────────

describe('forwardToLlm', () => {
  let forwardToLlm: typeof import('./index').forwardToLlm;
  let server: http.Server | null = null;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./index');
    forwardToLlm = mod.forwardToLlm;
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  function listenOnRandomPort(handler: http.RequestListener): Promise<number> {
    return new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, () => {
        const addr = server!.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
      });
    });
  }

  it('forwards body and receives response', async () => {
    const port = await listenOnRandomPort((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: body }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1/chat`), headers: { 'content-type': 'application/json' } },
        Buffer.from('{"test":true}'),
        (proxyRes) => {
          expect(proxyRes.statusCode).toBe(200);
          const chunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => chunks.push(c));
          proxyRes.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            expect(body.echo).toBe('{"test":true}');
            resolve();
          });
        },
        reject,
      );
    });
  });

  it('sets host and content-length headers on forwarded request', async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const port = await listenOnRandomPort((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1`), headers: { 'authorization': 'Bearer test' } },
        Buffer.from('hello'),
        (proxyRes) => {
          expect(receivedHeaders['host']).toBe(`localhost:${port}`);
          expect(receivedHeaders['content-length']).toBe('5');
          expect(receivedHeaders['authorization']).toBe('Bearer test');
          proxyRes.resume();
          proxyRes.on('end', resolve);
        },
        reject,
      );
    });
  });

  it('strips security headers from response', async () => {
    const port = await listenOnRandomPort((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-security-policy': "default-src 'self'",
        'cache-control': 'no-cache',
        'content-encoding': 'gzip',
        'clear-site-data': '"cookies"',
      });
      res.end('{}');
    });

    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1`), headers: {} },
        Buffer.alloc(0),
        (proxyRes) => {
          expect(proxyRes.headers['content-security-policy']).toBeUndefined();
          expect(proxyRes.headers['cache-control']).toBeUndefined();
          expect(proxyRes.headers['content-encoding']).toBeUndefined();
          expect(proxyRes.headers['clear-site-data']).toBeUndefined();
          expect(proxyRes.headers['content-type']).toBe('application/json');
          proxyRes.resume();
          proxyRes.on('end', resolve);
        },
        reject,
      );
    });
  });

  it('calls onError when connection fails', async () => {
    await new Promise<void>((resolve) => {
      forwardToLlm(
        { targetUrl: new URL('http://localhost:1/unreachable'), headers: {} },
        Buffer.alloc(0),
        () => { expect.unreachable('should not receive response'); },
        (err) => {
          expect(err).toBeInstanceOf(Error);
          resolve();
        },
      );
    });
  });

  it('handles SSE streaming response chunk by chunk', async () => {
    const port = await listenOnRandomPort((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":" World"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }, 10);
    });

    const receivedChunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1`), headers: {} },
        Buffer.from('{}'),
        (proxyRes) => {
          expect(proxyRes.headers['content-type']).toBe('text/event-stream');
          proxyRes.on('data', (chunk: Buffer) => receivedChunks.push(chunk.toString()));
          proxyRes.on('end', () => {
            const all = receivedChunks.join('');
            expect(all).toContain('Hello');
            expect(all).toContain('World');
            expect(all).toContain('[DONE]');
            resolve();
          });
        },
        reject,
      );
    });
  });

  it('preserves upstream error status codes', async () => {
    const port = await listenOnRandomPort((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate_limit_exceeded' }));
    });

    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1`), headers: {} },
        Buffer.from('{}'),
        (proxyRes) => {
          expect(proxyRes.statusCode).toBe(429);
          proxyRes.resume();
          proxyRes.on('end', resolve);
        },
        reject,
      );
    });
  });

  it('forwards correct path and query string', async () => {
    let receivedUrl = '';
    const port = await listenOnRandomPort((req, res) => {
      receivedUrl = req.url || '';
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>((resolve, reject) => {
      forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1/messages?beta=true`), headers: {} },
        Buffer.alloc(0),
        (proxyRes) => {
          expect(receivedUrl).toBe('/v1/messages?beta=true');
          proxyRes.resume();
          proxyRes.on('end', resolve);
        },
        reject,
      );
    });
  });

  it('returns ClientRequest that can be destroyed to abort upstream', async () => {
    let serverSawClose = false;
    const port = await listenOnRandomPort((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const interval = setInterval(() => {
        if (!res.destroyed) {
          res.write('data: {"choices":[{"delta":{"content":"."}}]}\n\n');
        }
      }, 10);
      req.on('close', () => {
        clearInterval(interval);
        serverSawClose = true;
      });
    });

    await new Promise<void>((resolve) => {
      const clientReq = forwardToLlm(
        { targetUrl: new URL(`http://localhost:${port}/v1`), headers: {} },
        Buffer.from('{}'),
        (proxyRes) => {
          proxyRes.once('data', () => {
            clientReq.destroy();
          });
          proxyRes.on('error', () => resolve());
          proxyRes.on('close', () => resolve());
        },
        () => resolve(),
      );
    });

    // Server detects connection closed
    await new Promise((r) => setTimeout(r, 50));
    expect(serverSawClose).toBe(true);
  });
});
