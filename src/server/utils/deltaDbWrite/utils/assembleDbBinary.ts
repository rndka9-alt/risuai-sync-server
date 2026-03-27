/**
 * cache.dataCache의 블록 + 캐싱된 REMOTE 블록 → 전체 RisuSave 바이너리 조립.
 */

import type * as cache from '../../../cache';

const MAGIC = Buffer.from('RISUSAVE\0', 'utf-8');

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
 * cache.dataCache의 블록 + REMOTE 블록 raw bytes → 전체 RisuSave 바이너리.
 * null: 캐시 부족으로 조립 불가.
 */
export function assembleDbBinary(
  cacheModule: typeof cache,
  remoteBlocks: readonly Buffer[],
): Buffer | null {
  const parts: Buffer[] = [MAGIC];

  for (const [name, entry] of cacheModule.hashCache) {
    const data = cacheModule.dataCache.get(name);
    if (data === null) continue;
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    parts.push(encodeBlock(entry.type, name, json));
  }

  for (const raw of remoteBlocks) {
    parts.push(raw);
  }

  if (parts.length <= 1) return null;

  return Buffer.concat(parts);
}
