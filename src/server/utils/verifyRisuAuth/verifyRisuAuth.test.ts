import http from 'http';
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../config', () => ({
  UPSTREAM: { hostname: '127.0.0.1', port: '0' },
  LOG_LEVEL: 'error',
}));

import * as config from '../../config';
import { verifyRisuAuth } from './verifyRisuAuth';

function createMockUpstream(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === 'object') return addr.port;
  throw new Error('no address');
}

function setUpstream(port: number): void {
  // config.UPSTREAM is a plain mock object, so we can mutate it directly
  const upstream: { hostname: string; port: string } = config.UPSTREAM;
  upstream.hostname = '127.0.0.1';
  upstream.port = String(port);
}

let mockServer: http.Server | null = null;

afterEach(() => {
  return new Promise<void>((resolve) => {
    if (mockServer) {
      mockServer.close(() => resolve());
      mockServer = null;
    } else {
      resolve();
    }
  });
});

describe('verifyRisuAuth', () => {
  it('returns true when upstream responds with { status: "success" }', async () => {
    mockServer = await createMockUpstream((req, res) => {
      expect(req.headers['risu-auth']).toBe('valid-token');
      expect(req.url).toBe('/api/test_auth');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });
    setUpstream(getPort(mockServer));

    expect(await verifyRisuAuth('valid-token')).toBe(true);
  });

  it('returns false when upstream responds with { status: "incorrect" }', async () => {
    mockServer = await createMockUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'incorrect' }));
    });
    setUpstream(getPort(mockServer));

    expect(await verifyRisuAuth('bad-token')).toBe(false);
  });

  it('returns false when upstream responds with { status: "unset" }', async () => {
    mockServer = await createMockUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'unset' }));
    });
    setUpstream(getPort(mockServer));

    expect(await verifyRisuAuth('any-token')).toBe(false);
  });

  it('returns false when upstream returns non-200', async () => {
    mockServer = await createMockUpstream((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    setUpstream(getPort(mockServer));

    expect(await verifyRisuAuth('any-token')).toBe(false);
  });

  it('returns false when upstream returns invalid JSON', async () => {
    mockServer = await createMockUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not json');
    });
    setUpstream(getPort(mockServer));

    expect(await verifyRisuAuth('any-token')).toBe(false);
  });

  it('returns false when upstream is unreachable', async () => {
    setUpstream(1);

    expect(await verifyRisuAuth('any-token')).toBe(false);
  });
});
