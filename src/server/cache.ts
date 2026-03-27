import db from './db';
import * as config from './config';
import type { BlockType } from '../shared/blockTypes';
import { isBlockType } from '../shared/blockTypes';
import type { BlockChange, ChangeLogEntry, ChangesResponse, ManifestResponse } from '../shared/types';

export interface HashEntry {
  type: BlockType;
  hash: string;
}

// ─── Type guards ────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// getBlock 쿼리 결과: name 없이 type, hash, data만 반환
interface BlockGetResult {
  type: number;
  hash: string;
  data: string | null;
}

function isBlockGetResult(v: unknown): v is BlockGetResult {
  return isRecord(v) && typeof v.type === 'number' && typeof v.hash === 'string';
}

// allBlockHashes 쿼리 결과: name, type, hash 반환
interface BlockListResult {
  name: string;
  type: number;
  hash: string;
}

function isBlockListResult(v: unknown): v is BlockListResult {
  return isRecord(v)
    && typeof v.name === 'string'
    && typeof v.type === 'number'
    && typeof v.hash === 'string';
}

interface ChangelogRow {
  version: number;
  timestamp: number;
  sender_client_id: string | null;
  changed: string;
  deleted: string;
}

function isChangelogRow(v: unknown): v is ChangelogRow {
  return isRecord(v)
    && typeof v.version === 'number'
    && typeof v.timestamp === 'number'
    && typeof v.changed === 'string'
    && typeof v.deleted === 'string';
}

interface CountRow { count: number }
function isCountRow(v: unknown): v is CountRow {
  return isRecord(v) && typeof v.count === 'number';
}

interface VersionRow { version: number }
function isVersionRow(v: unknown): v is VersionRow {
  return isRecord(v) && typeof v.version === 'number';
}

// ─── Prepared statements ────────────────────────────────

const stmt = {
  getBlock: db.prepare('SELECT type, hash, data FROM blocks WHERE name = ?'),
  upsertHash: db.prepare(
    'INSERT INTO blocks (name, type, hash) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET type = excluded.type, hash = excluded.hash',
  ),
  upsertData: db.prepare(
    'INSERT INTO blocks (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data',
  ),
  deleteBlock: db.prepare('DELETE FROM blocks WHERE name = ?'),
  hasBlock: db.prepare('SELECT 1 FROM blocks WHERE name = ?'),
  countBlocks: db.prepare('SELECT COUNT(*) as count FROM blocks'),
  allBlockHashes: db.prepare('SELECT name, type, hash FROM blocks'),

  insertChange: db.prepare(
    'INSERT INTO changelog (version, timestamp, sender_client_id, changed, deleted) VALUES (?, ?, ?, ?, ?)',
  ),
  changesSince: db.prepare('SELECT * FROM changelog WHERE version > ? ORDER BY version'),
  oldestVersion: db.prepare('SELECT version FROM changelog ORDER BY version ASC LIMIT 1'),
  changelogCount: db.prepare('SELECT COUNT(*) as count FROM changelog'),
  trimChangelog: db.prepare(
    'DELETE FROM changelog WHERE version NOT IN (SELECT version FROM changelog ORDER BY version DESC LIMIT ?)',
  ),
};

// ─── Hash cache (SQLite blocks 테이블) ──────────────────

class SqliteHashCache {
  get(name: string): HashEntry | undefined {
    const row = stmt.getBlock.get(name);
    if (!isBlockGetResult(row) || !isBlockType(row.type)) return undefined;
    return { type: row.type, hash: row.hash };
  }

  set(name: string, entry: HashEntry): this {
    stmt.upsertHash.run(name, entry.type, entry.hash);
    return this;
  }

  delete(name: string): boolean {
    return stmt.deleteBlock.run(name).changes > 0;
  }

  has(name: string): boolean {
    return stmt.hasBlock.get(name) !== undefined;
  }

  get size(): number {
    const row = stmt.countBlocks.get();
    return isCountRow(row) ? row.count : 0;
  }

  *[Symbol.iterator](): IterableIterator<[string, HashEntry]> {
    for (const row of stmt.allBlockHashes.iterate()) {
      if (isBlockListResult(row) && isBlockType(row.type)) {
        yield [row.name, { type: row.type, hash: row.hash }];
      }
    }
  }
}

export const hashCache = new SqliteHashCache();

// ─── Data cache (SQLite blocks 테이블, data 컬럼) ───────

class SqliteDataCache {
  set(name: string, value: unknown): void {
    stmt.upsertData.run(name, JSON.stringify(value));
  }

  get(name: string): unknown | null {
    const row = stmt.getBlock.get(name);
    if (!isBlockGetResult(row) || row.data === null) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return row.data;
    }
  }

  delete(name: string): void {
    stmt.deleteBlock.run(name);
  }

  get size(): number {
    const row = stmt.countBlocks.get();
    return isCountRow(row) ? row.count : 0;
  }
}

export const dataCache = new SqliteDataCache();

// ─── Scalar state (서버 인스턴스별 고유, 매 시작마다 초기화) ─

export const epoch = Date.now();
export let cacheInitialized = false;
export let currentVersion = 0;

export function setCacheInitialized(v: boolean): void {
  cacheInitialized = v;
}

// ─── Changelog (SQLite changelog 테이블) ────────────────

export function addChangeLogEntry(
  changed: BlockChange[],
  deleted: string[],
  senderClientId?: string | null,
): number {
  currentVersion++;
  stmt.insertChange.run(
    currentVersion,
    Date.now(),
    senderClientId || null,
    JSON.stringify(changed),
    JSON.stringify(deleted),
  );

  const countRow = stmt.changelogCount.get();
  if (isCountRow(countRow) && countRow.count > config.MAX_LOG_ENTRIES) {
    stmt.trimChangelog.run(config.MAX_LOG_ENTRIES);
  }

  return currentVersion;
}

interface ChangesResult {
  status: number;
  data: ChangesResponse | { error: string; version: number; epoch: number };
}

export function getChangesSince(since: number, excludeClientId?: string | null): ChangesResult {
  const oldestRow = stmt.oldestVersion.get();
  if (!isVersionRow(oldestRow) || since >= currentVersion) {
    return { status: 200, data: { epoch, version: currentVersion, changes: [] } };
  }
  if (since > 0 && since < oldestRow.version) {
    return { status: 410, data: { error: 'version_expired', version: currentVersion, epoch } };
  }
  let changes: ChangeLogEntry[] = [];
  for (const row of stmt.changesSince.iterate(since)) {
    if (!isChangelogRow(row)) continue;
    changes.push({
      version: row.version,
      timestamp: row.timestamp,
      senderClientId: row.sender_client_id,
      changed: JSON.parse(row.changed),
      deleted: JSON.parse(row.deleted),
    });
  }
  if (excludeClientId) {
    changes = changes.filter((entry) => entry.senderClientId !== excludeClientId);
  }
  return { status: 200, data: { epoch, version: currentVersion, changes } };
}

// ─── Manifest ───────────────────────────────────────────

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
