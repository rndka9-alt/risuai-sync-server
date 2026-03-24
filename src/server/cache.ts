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
 * Data cache — 용량 제한 없는 단순 캐시.
 * 항목 수가 캐릭터 수 + 고정 블록(~5개)으로 자연 제한되므로 eviction 불필요.
 */
class DataCache {
  private cache = new Map<string, unknown>();

  set(name: string, value: unknown): void {
    this.cache.set(name, value);
  }

  get(name: string): unknown | null {
    return this.cache.get(name) ?? null;
  }

  delete(name: string): void {
    this.cache.delete(name);
  }

  get size(): number {
    return this.cache.size;
  }
}

export const dataCache = new DataCache();

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
