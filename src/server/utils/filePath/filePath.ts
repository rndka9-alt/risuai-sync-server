import type { IncomingMessage } from 'http';
import { FILE_PATH_HEADER } from '../../../shared/headers';
import * as config from '../../config';
import { hexDecode } from './utils/hexDecode';

/** hex file-path 디코딩 (로깅용) */
export function hexDecodeFilePath(hex: string): string {
  return hexDecode(hex);
}

/** DB write 감지 */
export function isDbWrite(req: IncomingMessage): boolean {
  if (req.method !== 'POST' || req.url !== '/api/write') return false;
  const fp = req.headers[FILE_PATH_HEADER];
  if (!fp || typeof fp !== 'string') return false;
  try {
    return hexDecode(fp) === config.DB_PATH;
  } catch {
    return false;
  }
}

/** DB read 감지 */
export function isDbRead(req: IncomingMessage): boolean {
  if (req.method !== 'GET' || req.url !== '/api/read') return false;
  const fp = req.headers[FILE_PATH_HEADER];
  if (!fp || typeof fp !== 'string') return false;
  try {
    return hexDecode(fp) === config.DB_PATH;
  } catch {
    return false;
  }
}

/** Remote block write 감지 (Node 서버 모드: remotes/{charId}.local.bin) */
const REMOTE_FILE_RE = /^remotes\/(.+)\.local\.bin$/;

export function isRemoteBlockWrite(req: IncomingMessage): boolean {
  if (req.method !== 'POST' || req.url !== '/api/write') return false;
  const fp = req.headers[FILE_PATH_HEADER];
  if (!fp || typeof fp !== 'string') return false;
  try {
    return REMOTE_FILE_RE.test(hexDecode(fp));
  } catch {
    return false;
  }
}

export function extractCharIdFromFilePath(req: IncomingMessage): string | null {
  const fp = req.headers[FILE_PATH_HEADER];
  if (!fp || typeof fp !== 'string') return null;
  try {
    const match = hexDecode(fp).match(REMOTE_FILE_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
