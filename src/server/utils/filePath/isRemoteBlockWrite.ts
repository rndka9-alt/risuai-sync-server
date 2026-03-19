import type { IncomingMessage } from 'http';
import { FILE_PATH_HEADER } from '../../../shared/headers';
import { hexDecode } from './utils/hexDecode';
import { REMOTE_FILE_RE } from './utils/remoteFileRe';

/** Remote block write 감지 (Node 서버 모드: remotes/{charId}.local.bin) */
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
