import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';
import { sendUpstreamWithRetry } from '../sendUpstreamWithRetry';
import { sendJson } from '../sendJson';

/**
 * POST /sync/batch-write
 *
 * 에셋 등 diff 불필요 파일을 한 요청으로 묶어 수신 → upstream 병렬 전달.
 * 와이어 포맷: [4B BE: JSON 헤더 길이][JSON 헤더][파일1 본문][파일2 본문]...
 */

import { parseBatchBody } from './utils/parseBatchBody';

interface FileResult {
  ok: boolean;
  status?: number;
}

function bufferBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forwardOne(
  req: http.IncomingMessage,
  filePath: string,
  body: Buffer,
): Promise<FileResult> {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: config.UPSTREAM.host,
    'file-path': filePath,
    'content-type': 'application/octet-stream',
    'content-length': String(body.length),
  };
  delete headers[config.CLIENT_ID_HEADER];
  delete headers['x-sync-client-id'];
  // batch-write 자체의 content-type/length를 개별 파일의 것으로 교체했으므로
  // transfer-encoding 충돌 방지
  delete headers['transfer-encoding'];

  return new Promise((resolve) => {
    sendUpstreamWithRetry(
      { path: '/api/write', method: 'POST', headers, body },
      (proxyRes) => {
        proxyRes.resume();
        const status = proxyRes.statusCode ?? 0;
        resolve(status >= 200 && status < 300
          ? { ok: true }
          : { ok: false, status });
      },
      () => resolve({ ok: false, status: 502 }),
    );
  });
}

export function handleBatchWrite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  bufferBody(req).then(async (buf) => {
    const parsed = parseBatchBody(buf);
    if (!parsed) {
      sendJson(res, 400, { error: 'invalid batch payload' });
      return;
    }

    const { header, bodies } = parsed;
    logger.info('batch-write received', { files: String(header.files.length) });

    const results = await Promise.all(
      header.files.map((file, i) => forwardOne(req, file.filePath, bodies[i])),
    );

    const allOk = results.every((r) => r.ok);
    sendJson(res, allOk ? 200 : 207, { results });
  }).catch((err) => {
    logger.error('batch-write error', { error: String(err) });
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
  });
}
