import http from 'http';
import { BLOCK_TYPE } from '../../../shared/blockTypes';
import * as config from '../../config';
import * as logger from '../../logger';
import * as cache from '../../cache';
import { sendUpstreamWithRetry } from '../sendUpstreamWithRetry';
import { assembleDbBinary } from './utils/assembleDbBinary';

/** 마지막 database.bin raw body — REMOTE 블록 추출용 */
let cachedDbBinary: Buffer | null = null;

export function getCachedDbBinary(): Buffer | null {
  return cachedDbBinary;
}

export function setCachedDbBinary(body: Buffer): void {
  cachedDbBinary = body;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface BlockDelta {
  type: number;
  patch: unknown;
}

interface DeltaPayload {
  blocks: Record<string, BlockDelta>;
}

function isDeltaPayload(v: unknown): v is DeltaPayload {
  if (!isRecord(v)) return false;
  if (!isRecord(v.blocks)) return false;
  return true;
}

function bufferBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isRemoteBlockType(type: number): boolean {
  return type === BLOCK_TYPE.WITH_CHAT || type === BLOCK_TYPE.WITHOUT_CHAT;
}

/**
 * patch를 기존 값에 재귀적으로 적용.
 * - patch가 객체이고 base도 객체: 키 단위 merge (null 값은 삭제)
 * - 그 외: 전체 교체
 */
function applyPatch(base: unknown, patch: unknown): unknown {
  if (isRecord(patch) && isRecord(base)) {
    const result: Record<string, unknown> = { ...base };
    for (const key of Object.keys(patch)) {
      if (patch[key] === null) {
        delete result[key];
      } else if (isRecord(patch[key]) && isRecord(result[key])) {
        result[key] = applyPatch(result[key], patch[key]);
      } else {
        result[key] = patch[key];
      }
    }
    return result;
  }
  return patch;
}

function buildUpstreamHeaders(
  req: http.IncomingMessage,
  filePath: string,
  contentLength: number,
): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: config.UPSTREAM.host,
    'file-path': Buffer.from(filePath, 'utf-8').toString('hex'),
    'content-type': 'application/octet-stream',
    'content-length': String(contentLength),
  };
  delete headers[config.CLIENT_ID_HEADER];
  delete headers['x-sync-client-id'];
  return headers;
}

/** sendUpstreamWithRetry의 Promise 래퍼. 2xx 이외 또는 연결 실패 시 reject. */
function sendUpstreamPromise(
  options: { path: string; method: string; headers: Record<string, string | string[] | undefined>; body: Buffer },
): Promise<void> {
  return new Promise((resolve, reject) => {
    sendUpstreamWithRetry(
      options,
      (proxyRes) => {
        proxyRes.resume();
        const status = proxyRes.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve();
        } else {
          reject(new Error(`upstream ${status}`));
        }
      },
      () => reject(new Error('upstream_failed')),
    );
  });
}

export interface RemoteWriteOps {
  reserveRemoteWrite: (charId: string) => number;
  enqueueRemoteWrite: (seq: number, charId: string, buffer: Buffer, senderClientId: string | null) => void;
  skipRemoteWrite: (seq: number, charId: string) => void;
}

/**
 * POST /sync/delta-write
 *
 * JSON delta 수신 → cache.dataCache에 patch 적용.
 * DB 블록 (root, config 등): 전체 바이너리 pack → upstream.
 * Remote 블록 (캐릭터): JSON → upstream /api/write (remotes/{charId}.local.bin).
 * 409: 캐시 없음 → 클라이언트가 전체 전송으로 fallback.
 */
export function handleDeltaWrite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  processDbWrite: (buffer: Buffer, senderClientId: string | null) => void,
  remoteWriteOps: RemoteWriteOps,
  notifyWriteFailed: (clientId: string | null, url: string, attempts: number) => void,
): void {
  const rawClientId = req.headers[config.CLIENT_ID_HEADER];
  const senderClientId = typeof rawClientId === 'string' ? rawClientId : null;

  bufferBody(req).then((rawBody) => {
    if (!cache.cacheInitialized) {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_cache' }));
      return;
    }

    let delta: DeltaPayload;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf-8'));
      if (!isDeltaPayload(parsed)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_delta_format' }));
        return;
      }
      delta = parsed;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    // 블록 분류 + patch 적용
    const dbBlockNames: string[] = [];
    const remoteBlocks: Array<{ name: string; type: number }> = [];

    for (const [name, blockDelta] of Object.entries(delta.blocks)) {
      const cached = cache.dataCache.get(name);

      if (isRemoteBlockType(blockDelta.type)) {
        if (cached === null) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'no_cache', block: name }));
          return;
        }
        cache.dataCache.set(name, applyPatch(cached, blockDelta.patch));
        remoteBlocks.push({ name, type: blockDelta.type });
      } else {
        if (cached !== null) {
          cache.dataCache.set(name, applyPatch(cached, blockDelta.patch));
        } else {
          cache.dataCache.set(name, blockDelta.patch);
        }
        cache.hashCache.set(name, { type: blockDelta.type, hash: '' });
        dbBlockNames.push(name);
      }
    }

    // DB 블록만: 기존 플로우 (upstream response 파이핑)
    if (remoteBlocks.length === 0) {
      sendDbBinaryUpstream(rawBody, dbBlockNames, req, res, senderClientId, processDbWrite, notifyWriteFailed);
      return;
    }

    // Remote 블록 포함: 모든 upstream 완료 후 JSON 응답
    sendMixedUpstream(rawBody, dbBlockNames, remoteBlocks, req, res, senderClientId, processDbWrite, remoteWriteOps, notifyWriteFailed);
  }).catch((err) => {
    logger.error('delta-write body read error', { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
    }
    res.end('Internal Server Error');
  });
}

/** DB 블록만: 기존 플로우 (바이너리 조립 → upstream → response 파이핑) */
function sendDbBinaryUpstream(
  rawBody: Buffer,
  dbBlockNames: string[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  senderClientId: string | null,
  processDbWrite: (buffer: Buffer, senderClientId: string | null) => void,
  notifyWriteFailed: (clientId: string | null, url: string, attempts: number) => void,
): void {
  const fullBody = assembleDbBinary(cache, cachedDbBinary);
  if (!fullBody) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'assemble_failed' }));
    return;
  }

  logger.info('delta-write (db)', {
    patchedBlocks: String(dbBlockNames.length),
    deltaKB: String((rawBody.length / 1024).toFixed(1)),
    fullKB: String((fullBody.length / 1024).toFixed(1)),
  });

  cachedDbBinary = fullBody;

  const headers = buildUpstreamHeaders(req, config.DB_PATH, fullBody.length);

  sendUpstreamWithRetry(
    { path: '/api/write', method: 'POST', headers, body: fullBody },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);

      const status = proxyRes.statusCode ?? 0;
      if (status >= 200 && status < 300) {
        setImmediate(() => processDbWrite(fullBody, senderClientId));
      }
    },
    () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
      }
      res.end('Bad Gateway');
      notifyWriteFailed(senderClientId, '/sync/delta-write', config.RETRY_MAX_ATTEMPTS + 1);
    },
  );
}

/** Remote 블록 포함: DB + remote 각각 upstream 전송 → JSON 응답 */
function sendMixedUpstream(
  rawBody: Buffer,
  dbBlockNames: string[],
  remoteBlocks: Array<{ name: string; type: number }>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  senderClientId: string | null,
  processDbWrite: (buffer: Buffer, senderClientId: string | null) => void,
  remoteWriteOps: RemoteWriteOps,
  notifyWriteFailed: (clientId: string | null, url: string, attempts: number) => void,
): void {
  let failCount = 0;
  const tasks: Array<Promise<void>> = [];

  // DB blocks
  let dbBinary: Buffer | null = null;
  if (dbBlockNames.length > 0) {
    dbBinary = assembleDbBinary(cache, cachedDbBinary);
    if (!dbBinary) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'assemble_failed' }));
      return;
    }
    cachedDbBinary = dbBinary;

    const body = dbBinary;
    const headers = buildUpstreamHeaders(req, config.DB_PATH, body.length);
    tasks.push(
      sendUpstreamPromise({ path: '/api/write', method: 'POST', headers, body }).then(() => {
        setImmediate(() => processDbWrite(body, senderClientId));
      }).catch(() => { failCount++; }),
    );
  }

  // Remote blocks
  for (const rb of remoteBlocks) {
    const patched = cache.dataCache.get(rb.name);
    const json = JSON.stringify(patched);
    const buffer = Buffer.from(json, 'utf-8');
    const filePath = `remotes/${rb.name}.local.bin`;
    const seq = remoteWriteOps.reserveRemoteWrite(rb.name);

    const headers = buildUpstreamHeaders(req, filePath, buffer.length);
    tasks.push(
      sendUpstreamPromise({ path: '/api/write', method: 'POST', headers, body: buffer }).then(() => {
        setImmediate(() => remoteWriteOps.enqueueRemoteWrite(seq, rb.name, buffer, senderClientId));
      }).catch(() => {
        remoteWriteOps.skipRemoteWrite(seq, rb.name);
        failCount++;
      }),
    );
  }

  logger.info('delta-write (mixed)', {
    dbBlocks: String(dbBlockNames.length),
    remoteBlocks: String(remoteBlocks.length),
    deltaKB: String((rawBody.length / 1024).toFixed(1)),
  });

  Promise.all(tasks).then(() => {
    if (failCount > 0) {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream_failed' }));
      }
      notifyWriteFailed(senderClientId, '/sync/delta-write', config.RETRY_MAX_ATTEMPTS + 1);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
  });
}
