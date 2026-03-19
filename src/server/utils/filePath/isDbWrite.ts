import type { IncomingMessage } from 'http';
import { FILE_PATH_HEADER } from '../../../shared/headers';
import * as config from '../../config';
import { hexDecode } from './utils/hexDecode';

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
