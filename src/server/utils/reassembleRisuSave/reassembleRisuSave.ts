import zlib from 'zlib';
import { BLOCK_TYPE } from '../../../shared/blockTypes';

const MAGIC_HEADER = Buffer.from('RISUSAVE\0', 'utf-8');

/**
 * RisuSave 바이너리의 ROOT 블록 JSON을 교체하여 재조립한다.
 * ROOT 이외의 블록은 원본 바이트를 그대로 복사한다.
 *
 * @returns 재조립된 버퍼, 실패 시 null
 */
export function reassembleRisuSave(
  original: Buffer,
  modifiedRootJson: string,
): Buffer | null {
  if (original.length < MAGIC_HEADER.length) return null;
  for (let i = 0; i < MAGIC_HEADER.length; i++) {
    if (original[i] !== MAGIC_HEADER[i]) return null;
  }

  const parts: Buffer[] = [MAGIC_HEADER];
  let offset = MAGIC_HEADER.length;

  while (offset + 7 <= original.length) {
    const blockStart = offset;

    const rawType = original[offset];
    const compression = original[offset + 1];
    offset += 2;

    const nameLen = original[offset];
    offset += 1;

    if (offset + nameLen + 4 > original.length) break;

    const name = original.slice(offset, offset + nameLen).toString('utf-8');
    offset += nameLen;

    const dataLen = original.readUInt32LE(offset);
    offset += 4;

    if (offset + dataLen > original.length) break;

    offset += dataLen;

    if (rawType === BLOCK_TYPE.ROOT) {
      let newData = Buffer.from(modifiedRootJson, 'utf-8');
      if (compression === 1) {
        newData = zlib.gzipSync(newData);
      }

      const header = Buffer.alloc(3 + nameLen + 4);
      header[0] = rawType;
      header[1] = compression;
      header[2] = nameLen;
      Buffer.from(name, 'utf-8').copy(header, 3);
      header.writeUInt32LE(newData.length, 3 + nameLen);

      parts.push(header, newData);
    } else {
      parts.push(original.slice(blockStart, offset));
    }
  }

  return Buffer.concat(parts);
}
