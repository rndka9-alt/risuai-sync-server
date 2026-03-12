'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const { BLOCK_TYPE } = require('./blockTypes');

const MAGIC_HEADER = Buffer.from('RISUSAVE\0', 'utf-8');

/**
 * RisuSave 바이너리를 파싱하여 블록별 해시와 JSON을 추출한다.
 * REMOTE 블록이 포함되면 null 반환 (Phase 1 fallback).
 *
 * @param {Buffer} buffer
 * @returns {{ blocks: Map<string, {type:number, hash:string, json:string}>, directory: string[] } | null}
 */
function parseRisuSaveBlocks(buffer) {
  if (buffer.length < MAGIC_HEADER.length) return null;
  for (let i = 0; i < MAGIC_HEADER.length; i++) {
    if (buffer[i] !== MAGIC_HEADER[i]) return null;
  }

  const blocks = new Map();
  let directory = [];
  let offset = MAGIC_HEADER.length;
  let hasRemote = false;

  while (offset + 7 <= buffer.length) {
    try {
      const type = buffer[offset];
      const compression = buffer[offset + 1];
      offset += 2;

      const nameLen = buffer[offset];
      offset += 1;

      if (offset + nameLen + 4 > buffer.length) break;

      const name = buffer.slice(offset, offset + nameLen).toString('utf-8');
      offset += nameLen;

      const dataLen = buffer.readUInt32LE(offset);
      offset += 4;

      if (offset + dataLen > buffer.length) break;

      let data = buffer.slice(offset, offset + dataLen);
      offset += dataLen;

      // REMOTE 블록 → Phase 1 fallback
      if (type === BLOCK_TYPE.REMOTE) {
        hasRemote = true;
        continue;
      }

      if (compression === 1) {
        try {
          data = zlib.gunzipSync(data);
        } catch (e) {
          console.error(`[Sync] Failed to decompress block "${name}":`, e.message);
          continue;
        }
      }

      const hash = crypto.createHash('sha256').update(data).digest('hex');
      const jsonStr = data.toString('utf-8');

      blocks.set(name, { type, hash, json: jsonStr });

      // ROOT 블록에서 __directory 추출
      if (type === BLOCK_TYPE.ROOT) {
        try {
          const rootData = JSON.parse(jsonStr);
          if (rootData.__directory) {
            directory = rootData.__directory;
          }
        } catch {}
      }
    } catch (e) {
      console.error('[Sync] Block parse error at offset', offset, ':', e.message);
      break;
    }
  }

  if (hasRemote) return null;

  return { blocks, directory };
}

module.exports = { parseRisuSaveBlocks };
