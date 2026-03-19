import { hexDecode } from './utils/hexDecode';

/** hex file-path 디코딩 (로깅용) */
export function hexDecodeFilePath(hex: string): string {
  return hexDecode(hex);
}
