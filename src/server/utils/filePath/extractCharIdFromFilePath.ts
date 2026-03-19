import type { IncomingMessage } from 'http';
import { FILE_PATH_HEADER } from '../../../shared/headers';
import { hexDecode } from './utils/hexDecode';
import { REMOTE_FILE_RE } from './utils/remoteFileRe';

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
