import crypto from 'crypto';
import zlib from 'zlib';
import { isBlockType } from '../../../shared/blockTypes';
import type { BlockType } from '../../../shared/blockTypes';
import { BufferedAsyncReader } from './utils/BufferedAsyncReader';

const MAGIC_LEN = 9; // "RISUSAVE\0"

export interface StreamParsedBlock {
  type: BlockType;
  compression: number;
  name: string;
  /** 원본 데이터 (압축 상태 그대로) */
  rawData: Buffer;
  /** 압축 해제된 데이터 (compression === 0이면 rawData와 동일 참조) */
  data: Buffer;
  /** SHA-256 hex hash (data 기준) */
  hash: string;
}

/**
 * RisuSave 바이너리 스트림을 블록 단위로 파싱한다.
 * 전체 바이너리를 메모리에 올리지 않고 블록 하나씩 yield.
 */
export async function* streamParseRisuSave(
  readable: AsyncIterable<Uint8Array>,
): AsyncGenerator<StreamParsedBlock> {
  const reader = new BufferedAsyncReader(readable);

  const magic = await reader.readExact(MAGIC_LEN);
  if (!magic) return;

  while (true) {
    // type(1) + compression(1) + nameLen(1)
    const headerBuf = await reader.readExact(3);
    if (!headerBuf) break;

    const rawType = headerBuf[0];
    const compression = headerBuf[1];
    const nameLen = headerBuf[2];

    if (!isBlockType(rawType)) break;
    const type: BlockType = rawType;

    const nameBuf = await reader.readExact(nameLen);
    if (!nameBuf) break;
    const name = nameBuf.toString('utf-8');

    const dataLenBuf = await reader.readExact(4);
    if (!dataLenBuf) break;
    const dataLen = dataLenBuf.readUInt32LE(0);

    const rawData = await reader.readExact(dataLen);
    if (!rawData) break;

    let data: Buffer;
    if (compression === 1) {
      try {
        data = zlib.gunzipSync(rawData);
      } catch {
        continue;
      }
    } else {
      data = rawData;
    }

    const hash = crypto.createHash('sha256').update(data).digest('hex');

    yield { type, compression, name, rawData, data, hash };
  }
}

/** 파싱된 블록을 RisuSave 바이너리 블록 형식으로 인코딩 (원본 보존) */
export function encodeRawBlock(block: StreamParsedBlock): Buffer {
  const nameBytes = Buffer.from(block.name, 'utf-8');
  const buf = Buffer.alloc(3 + nameBytes.length + 4 + block.rawData.length);
  let offset = 0;
  buf[offset++] = block.type;
  buf[offset++] = block.compression;
  buf[offset++] = nameBytes.length;
  nameBytes.copy(buf, offset);
  offset += nameBytes.length;
  buf.writeUInt32LE(block.rawData.length, offset);
  offset += 4;
  block.rawData.copy(buf, offset);
  return buf;
}
