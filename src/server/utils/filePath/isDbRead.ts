import type { IncomingMessage } from 'http';
import { FILE_PATH_HEADER } from '../../../shared/headers';
import * as config from '../../config';
import { hexDecode } from './utils/hexDecode';

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
