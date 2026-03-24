import * as config from './config';
import type { BlockType } from '../shared/blockTypes';
import type { BlockChange, ChangeLogEntry, ChangesResponse, ManifestResponse } from '../shared/types';

/**
 * 블록 해시 캐시 — 블록 내용 변경 감지용.
 * 바이너리에 실제 데이터가 포함된 블록만 등록됨.
 * RisuAI incremental save 특성상 대부분 root 블록만 포함되며,
 * 캐릭터 블록은 해당 캐릭터 수정 시에만 간헐적으로 등장.
 * 캐릭터 목록(추가/삭제) 감지에는 사용 불가 → diffDirectory() 참조.
 */
export interface HashEntry {
  type: BlockType;
  hash: string;
}

export const hashCache = new Map<string, HashEntry>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Data cache (LRU eviction, 용량 제한).
 * 파싱된 JS 객체를 직접 저장. size 추정은 set 시 JSON.stringify length.
 */
class SizedCache {
  private maxSize: number;
  private cache = new Map<string, { data: unknown; size: number }>();
  private currentSize = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  set(name: string, value: unknown): void {
    const size = typeof value === 'string'
      ? Buffer.byteLength(value, 'utf-8')
      : Buffer.byteLength(JSON.stringify(value), 'utf-8');
    if (this.cache.has(name)) {
      this.currentSize -= this.cache.get(name)!.size;
      this.cache.delete(name);
    }
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value!;
      this.currentSize -= this.cache.get(oldest)!.size;
      this.cache.delete(oldest);
    }
    if (size > this.maxSize) return;
    this.cache.set(name, { data: value, size });
    this.currentSize += size;
  }

  get(name: string): unknown | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    // LRU: move to end
    this.cache.delete(name);
    this.cache.set(name, entry);
    return entry.data;
  }

  delete(name: string): void {
    if (this.cache.has(name)) {
      this.currentSize -= this.cache.get(name)!.size;
      this.cache.delete(name);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

export const dataCache = new SizedCache(config.MAX_CACHE_SIZE);

/** 내부 상태 */
export const epoch = Date.now();
export let cacheInitialized = false;
export let currentVersion = 0;

export function setCacheInitialized(v: boolean): void {
  cacheInitialized = v;
}

const changeLog: ChangeLogEntry[] = [];

/** 변경 로그 */
export function addChangeLogEntry(
  changed: BlockChange[],
  deleted: string[],
  senderClientId?: string | null,
): number {
  currentVersion++;
  changeLog.push({
    version: currentVersion,
    timestamp: Date.now(),
    changed,
    deleted,
    senderClientId: senderClientId || null,
  });
  while (changeLog.length > config.MAX_LOG_ENTRIES) {
    changeLog.shift();
  }
  return currentVersion;
}

interface ChangesResult {
  status: number;
  data: ChangesResponse | { error: string; version: number; epoch: number };
}

/**
 * since 이후의 변경분을 반환.
 * excludeClientId가 주어지면 해당 클라이언트가 보낸 변경분은 제외.
 */
export function getChangesSince(since: number, excludeClientId?: string | null): ChangesResult {
  if (changeLog.length === 0 || since >= currentVersion) {
    return { status: 200, data: { epoch, version: currentVersion, changes: [] } };
  }
  const oldestVersion = changeLog[0].version;
  if (since > 0 && since < oldestVersion) {
    return { status: 410, data: { error: 'version_expired', version: currentVersion, epoch } };
  }
  let changes = changeLog.filter((entry) => entry.version > since);
  if (excludeClientId) {
    changes = changes.filter((entry) => entry.senderClientId !== excludeClientId);
  }
  return { status: 200, data: { epoch, version: currentVersion, changes } };
}

export function getManifest(): ManifestResponse {
  const blocks: ManifestResponse['blocks'] = [];
  for (const [name, { type, hash }] of hashCache) {
    blocks.push({ name, type, hash });
  }
  let directory: string[] = [];
  const rootData = dataCache.get('root');
  if (isRecord(rootData) && Array.isArray(rootData.__directory)) {
    directory = rootData.__directory;
  }

  return {
    epoch,
    version: currentVersion,
    cacheInitialized,
    blocks,
    directory,
  };
}
