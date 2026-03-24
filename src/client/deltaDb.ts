/**
 * Delta 경량화 — decoded object 기반.
 *
 * 인메모리에 블록별 파싱된 객체를 유지.
 * write 시 이전 객체와 재귀 deep compare → 변경된 부분만 추출하여 전송.
 * database.bin 블록과 remote 블록(캐릭터) 모두 동일한 diff 로직 적용.
 */

const MAGIC = 'RISUSAVE\0';

// --- RisuSave 디코더 ---

interface DecodedBlock {
  name: string;
  type: number;
  obj: unknown;
}

function decodeBlocks(buf: Uint8Array): DecodedBlock[] | null {
  if (buf.length < MAGIC.length) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (buf[i] !== MAGIC.charCodeAt(i)) return null;
  }

  const blocks: DecodedBlock[] = [];
  let offset = MAGIC.length;

  while (offset + 7 <= buf.length) {
    const type = buf[offset];
    const compression = buf[offset + 1];
    offset += 2;

    const nameLen = buf[offset];
    offset += 1;

    if (offset + nameLen + 4 > buf.length) break;
    const name = new TextDecoder().decode(buf.subarray(offset, offset + nameLen));
    offset += nameLen;

    const dataLen = new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;

    if (offset + dataLen > buf.length) break;
    const rawData = buf.subarray(offset, offset + dataLen);
    offset += dataLen;

    if (compression === 1) continue;

    try {
      const json = new TextDecoder().decode(rawData);
      blocks.push({ name, type, obj: JSON.parse(json) });
    } catch {
      continue;
    }
  }

  return blocks;
}

// --- 인메모리 캐시 ---

const blockCache = new Map<string, { type: number; obj: unknown }>();

// --- 타입가드 ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// --- 재귀 deep compare ---

/** 리터럴까지 파고들어 비교. 레퍼런스 같으면 early return. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;
  if (!isRecord(a) || !isRecord(b)) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!(key in b)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}

// --- Diff ---

/**
 * 두 값의 diff를 재귀적으로 추출.
 * - 둘 다 객체: 변경/추가/삭제된 키-값만 반환. 삭제된 키는 null.
 * - 그 외 (배열, 리터럴, 타입 불일치): 전체 새 값 반환.
 * - 동일하면 undefined.
 */
function diff(prev: unknown, next: unknown): unknown {
  if (deepEqual(prev, next)) return undefined;

  // 둘 다 객체 (배열 아닌)이면 키 단위 diff
  if (isRecord(prev) && isRecord(next)) {
    const patch: Record<string, unknown> = {};
    let count = 0;

    for (const key of Object.keys(next)) {
      const d = diff(prev[key], next[key]);
      if (d !== undefined) {
        patch[key] = d;
        count++;
      }
    }

    for (const key of Object.keys(prev)) {
      if (!(key in next)) {
        patch[key] = null;
        count++;
      }
    }

    return count > 0 ? patch : undefined;
  }

  // 배열, 리터럴, 타입 불일치 → 전체 교체
  return next;
}

// --- Delta payload ---

export interface BlockDelta {
  type: number;
  /** diff 결과. 객체면 키 단위 patch, 그 외면 전체 값 */
  patch: unknown;
}

export interface DeltaPayload {
  blocks: Record<string, BlockDelta>;
}

/**
 * database.bin read 응답으로 인메모리 캐시를 채움.
 */
export function warmCache(body: Uint8Array): void {
  const decoded = decodeBlocks(body);
  if (!decoded) return;

  blockCache.clear();
  for (const block of decoded) {
    blockCache.set(block.name, { type: block.type, obj: block.obj });
  }
}

export type ComputeDeltaResult =
  | 'no_cache'      // 캐시 없음 또는 파싱 실패 → full write 필요
  | 'no_changes'    // 변경 없음 → 전송 불필요
  | DeltaPayload;   // 변경분 → delta 전송

/**
 * database.bin body에서 변경분만 추출.
 */
export function computeDelta(body: Uint8Array): ComputeDeltaResult {
  if (blockCache.size === 0) {
    warmCache(body);
    return 'no_cache';
  }

  const decoded = decodeBlocks(body);
  if (!decoded) return 'no_cache';

  const deltas: Record<string, BlockDelta> = {};
  let hasChanges = false;

  for (const block of decoded) {
    const cached = blockCache.get(block.name);

    if (!cached) {
      // 새 블록: 전체 값
      deltas[block.name] = { type: block.type, patch: block.obj };
      hasChanges = true;
    } else {
      const d = diff(cached.obj, block.obj);
      if (d !== undefined) {
        deltas[block.name] = { type: block.type, patch: d };
        hasChanges = true;
      }
    }

    // 캐시 갱신
    blockCache.set(block.name, { type: block.type, obj: block.obj });
  }

  if (!hasChanges) return 'no_changes';

  return { blocks: deltas };
}

// --- Remote block (캐릭터) delta ---

/** charId → 파싱된 캐릭터 객체 */
const remoteBlockCache = new Map<string, unknown>();

/** WITH_CHAT block type (shared/blockTypes.ts 와 동일) */
const BLOCK_TYPE_WITH_CHAT = 2;

/**
 * Remote block read 응답으로 캐시를 채움. 첫 write부터 delta 가능.
 * 메모리 절약을 위해 활성 캐릭터 1개만 유지.
 */
export function warmRemoteCache(charId: string, body: Uint8Array): void {
  try {
    if (!remoteBlockCache.has(charId)) {
      remoteBlockCache.clear();
    }
    remoteBlockCache.set(charId, JSON.parse(new TextDecoder().decode(body)));
  } catch {
    // 파싱 실패 시 무시
  }
}

/**
 * Remote block body에서 변경분만 추출.
 * null: delta 불가 (캐시 없음, 파싱 실패, 변경 없음) → 전체 전송.
 */
export function computeRemoteDelta(charId: string, body: Uint8Array): DeltaPayload | null {
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }

  const cached = remoteBlockCache.get(charId);
  remoteBlockCache.set(charId, obj);

  if (cached === undefined) return null;

  const d = diff(cached, obj);
  if (d === undefined) return null;

  return { blocks: { [charId]: { type: BLOCK_TYPE_WITH_CHAT, patch: d } } };
}
