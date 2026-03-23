/**
 * RisuSave 바이너리에서 블록 이름 → raw bytes 매핑을 추출.
 * decompress하지 않고 바이너리 그대로 보존.
 */

const MAGIC = Buffer.from('RISUSAVE\0', 'utf-8');

export interface RawBlock {
  name: string;
  /** type(1) + compression(1) + nameLen(1) + name + dataLen(4) + data 전체 */
  raw: Buffer;
}

export function splitRawBlocks(buf: Buffer): RawBlock[] | null {
  if (buf.length < MAGIC.length) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC[i]) return null;
  }

  const blocks: RawBlock[] = [];
  let offset = MAGIC.length;

  while (offset + 7 <= buf.length) {
    const blockStart = offset;
    // type(1) + compression(1)
    offset += 2;

    const nameLen = buf[offset];
    offset += 1;

    if (offset + nameLen + 4 > buf.length) break;

    const name = buf.subarray(offset, offset + nameLen).toString('utf-8');
    offset += nameLen;

    const dataLen = buf.readUInt32LE(offset);
    offset += 4;

    if (offset + dataLen > buf.length) break;
    offset += dataLen;

    blocks.push({ name, raw: buf.subarray(blockStart, offset) });
  }

  return blocks;
}

export { MAGIC as RISUSAVE_MAGIC };
