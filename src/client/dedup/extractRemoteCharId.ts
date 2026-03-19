import { FILE_PATH_HEADER } from '../../shared/headers';
import { extractHeader } from '../utils/extractHeader';
import { hexDecode } from './utils/hexDecode';

const REMOTE_FILE_RE = /^remotes\/(.+)\.local\.bin$/;

/** file-path 헤더에서 remote block의 charId를 추출. remote block이 아니면 null. */
export function extractRemoteCharId(headers: HeadersInit): string | null {
  const fp = extractHeader(headers, FILE_PATH_HEADER);
  if (!fp) return null;
  try {
    const match = hexDecode(fp).match(REMOTE_FILE_RE);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
