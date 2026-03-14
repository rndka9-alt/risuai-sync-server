import * as config from './config';
import type { BlockType } from '../shared/blockTypes';
import type { BlockChange, ChangeLogEntry, ChangesResponse, ManifestResponse } from '../shared/types';

/** Hash cache (항상 메모리에 유지, 용량 무시 가능) */
export interface HashEntry {
  type: BlockType;
  hash: string;
}

export const hashCache = new Map<string, HashEntry>();

/** Data cache (LRU eviction, 용량 제한) */
class SizedCache {
  private maxSize: number;
  private cache = new Map<string, { data: string; size: number }>();
  private currentSize = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  set(name: string, jsonStr: string): void {
    const size = Buffer.byteLength(jsonStr, 'utf-8');
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
    this.cache.set(name, { data: jsonStr, size });
    this.currentSize += size;
  }

  get(name: string): string | null {
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
  return {
    epoch,
    version: currentVersion,
    cacheInitialized,
    blocks,
    directory: [...hashCache.keys()].filter(k => k !== 'root'),
  };
}
