import crypto from 'crypto';
import zlib from 'zlib';
import { BLOCK_TYPE, isBlockType } from '../shared/blockTypes';
import type { BlockType } from '../shared/blockTypes';

const MAGIC_HEADER = Buffer.from('RISUSAVE\0', 'utf-8');

export interface ParsedBlock {
  type: BlockType;
  hash: string;
  json: string;
}

export interface ParseResult {
  blocks: Map<string, ParsedBlock>;
  directory: string[];
}

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * RisuSave 바이너리를 파싱하여 블록별 해시와 JSON을 추출한다.
 * REMOTE 블록이 포함되면 null 반환 (Phase 1 fallback).
 */
export function parseRisuSaveBlocks(buffer: Buffer): ParseResult | null {
  if (buffer.length < MAGIC_HEADER.length) return null;
  for (let i = 0; i < MAGIC_HEADER.length; i++) {
    if (buffer[i] !== MAGIC_HEADER[i]) return null;
  }

  const blocks = new Map<string, ParsedBlock>();
  let directory: string[] = [];
  let offset = MAGIC_HEADER.length;
  let hasRemote = false;

  while (offset + 7 <= buffer.length) {
    try {
      const rawType = buffer[offset];
      const compression = buffer[offset + 1];
      offset += 2;

      if (!isBlockType(rawType)) {
        // 알 수 없는 블록 타입 — 이후 필드 해석 불가
        break;
      }
      const type: BlockType = rawType;

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
          console.error(`[Sync] Failed to decompress block "${name}":`, formatError(e));
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
        } catch {
          // 파싱 실패 무시
        }
      }
    } catch (e) {
      console.error('[Sync] Block parse error at offset', offset, ':', formatError(e));
      break;
    }
  }

  if (hasRemote) return null;

  return { blocks, directory };
}
