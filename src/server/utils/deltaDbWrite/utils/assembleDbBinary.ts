/**
 * cache.dataCache + cachedDbBinary에서 REMOTE 블록을 추출하여
 * 전체 RisuSave 바이너리를 조립.
 */

import type * as cache from '../../../cache';

const MAGIC = Buffer.from('RISUSAVE\0', 'utf-8');

interface RawRemoteBlock {
  raw: Buffer;
}

/** cachedDbBinary에서 REMOTE 블록(type 6)의 raw bytes만 추출 */
function extractRemoteBlocks(binary: Buffer): RawRemoteBlock[] {
  const remotes: RawRemoteBlock[] = [];
  let offset = MAGIC.length;

  while (offset + 7 <= binary.length) {
    const blockStart = offset;
    const type = binary[offset];
    offset += 2; // type + compression

    const nameLen = binary[offset];
    offset += 1;

    if (offset + nameLen + 4 > binary.length) break;
    offset += nameLen;

    const dataLen = binary.readUInt32LE(offset);
    offset += 4;

    if (offset + dataLen > binary.length) break;
    offset += dataLen;

    // type 6 = REMOTE
    if (type === 6) {
      remotes.push({ raw: binary.subarray(blockStart, offset) });
    }
  }

  return remotes;
}

/** 단일 블록을 RisuSave 바이너리 블록으로 인코딩 (비압축) */
function encodeBlock(type: number, name: string, json: string): Buffer {
  const nameBytes = Buffer.from(name, 'utf-8');
  const dataBytes = Buffer.from(json, 'utf-8');

  const buf = Buffer.alloc(2 + 1 + nameBytes.length + 4 + dataBytes.length);
  let offset = 0;

  buf[offset++] = type;
  buf[offset++] = 0; // compression: none
  buf[offset++] = nameBytes.length;
  nameBytes.copy(buf, offset);
  offset += nameBytes.length;
  buf.writeUInt32LE(dataBytes.length, offset);
  offset += 4;
  dataBytes.copy(buf, offset);

  return buf;
}

/**
 * cache.dataCache의 블록 + cachedDbBinary의 REMOTE 블록 → 전체 RisuSave 바이너리.
 * null: 캐시 부족으로 조립 불가.
 */
export function assembleDbBinary(
  cacheModule: typeof cache,
  cachedDbBinary: Buffer | null,
): Buffer | null {
  const parts: Buffer[] = [MAGIC];

  // dataCache에서 일반 블록 (root, preset, modules, config 등)
  for (const [name, entry] of cacheModule.hashCache) {
    const data = cacheModule.dataCache.get(name);
    if (data === null) continue;
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    parts.push(encodeBlock(entry.type, name, json));
  }

  // cachedDbBinary에서 REMOTE 블록 추출
  if (cachedDbBinary) {
    const remotes = extractRemoteBlocks(cachedDbBinary);
    for (const remote of remotes) {
      parts.push(remote.raw);
    }
  }

  if (parts.length <= 1) return null; // MAGIC만 있으면 실패

  return Buffer.concat(parts);
}
