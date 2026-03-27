import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB_DIR = process.env.SYNC_DB_DIR || os.tmpdir();
const DB_FILE = path.join(DB_DIR, `sync-cache-${process.pid}.sqlite`);

// 캐시 전용 DB: 서버 시작 시 이전 파일을 삭제하여 stale 데이터 방지
try {
  fs.unlinkSync(DB_FILE);
  fs.unlinkSync(DB_FILE + '-wal');
  fs.unlinkSync(DB_FILE + '-shm');
} catch {
  // 파일 없으면 무시
}

const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('auto_vacuum = INCREMENTAL');

db.exec(`
  CREATE TABLE blocks (
    name TEXT PRIMARY KEY,
    type INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT '',
    data TEXT
  );

  CREATE TABLE changelog (
    version INTEGER PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    sender_client_id TEXT,
    changed TEXT NOT NULL,
    deleted TEXT NOT NULL
  );

  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE client_state (
    client_id TEXT PRIMARY KEY,
    root_cache TEXT,
    disconnected_at INTEGER,
    trusted_at INTEGER
  );
`);

export default db;
