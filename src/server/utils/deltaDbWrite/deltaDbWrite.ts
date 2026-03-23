import http from 'http';
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

/**
 * POST /sync/delta-dbwrite
 *
 * JSON delta 수신 → cache.dataCache에 patch 적용 → 전체 바이너리 pack → upstream 전달.
 * 409: 캐시 없음 → 클라이언트가 전체 전송으로 fallback.
 */
export function handleDeltaDbWrite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  processDbWrite: (buffer: Buffer, senderClientId: string | null) => void,
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

    // 각 블록에 patch 적용
    let patchedCount = 0;
    for (const [name, blockDelta] of Object.entries(delta.blocks)) {
      const cachedJson = cache.dataCache.get(name);
      if (cachedJson !== null) {
        try {
          const base: unknown = JSON.parse(cachedJson);
          const patched = applyPatch(base, blockDelta.patch);
          cache.dataCache.set(name, JSON.stringify(patched));
        } catch {
          // 파싱 실패 → patch를 전체 교체로 처리
          cache.dataCache.set(name, JSON.stringify(blockDelta.patch));
        }
      } else {
        // 캐시에 없던 블록 → 새로 추가
        cache.dataCache.set(name, JSON.stringify(blockDelta.patch));
      }
      cache.hashCache.set(name, { type: blockDelta.type, hash: '' });
      patchedCount++;
    }

    // 전체 바이너리 pack
    const fullBody = assembleDbBinary(cache, cachedDbBinary);
    if (!fullBody) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'assemble_failed' }));
      return;
    }

    logger.info('delta-dbwrite', {
      patchedBlocks: String(patchedCount),
      deltaKB: String((rawBody.length / 1024).toFixed(1)),
      fullKB: String((fullBody.length / 1024).toFixed(1)),
    });

    cachedDbBinary = fullBody;

    // upstream 전달
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: config.UPSTREAM.host,
      'file-path': Buffer.from(config.DB_PATH, 'utf-8').toString('hex'),
      'content-type': 'application/octet-stream',
      'content-length': String(fullBody.length),
    };
    delete headers[config.CLIENT_ID_HEADER];
    delete headers['x-sync-client-id'];

    sendUpstreamWithRetry(
      { path: '/api/write', method: 'POST', headers, body: fullBody },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode!, proxyRes.headers);
        proxyRes.pipe(res);

        if (proxyRes.statusCode! >= 200 && proxyRes.statusCode! < 300) {
          setImmediate(() => processDbWrite(fullBody, senderClientId));
        }
      },
      () => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
        }
        res.end('Bad Gateway');
        notifyWriteFailed(senderClientId, '/sync/delta-dbwrite', config.RETRY_MAX_ATTEMPTS + 1);
      },
    );
  }).catch((err) => {
    logger.error('delta-dbwrite body read error', { error: String(err) });
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
    }
    res.end('Internal Server Error');
  });
}
