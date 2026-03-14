import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** .env 파서 (dotenv 의존성 없음) */
function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env 파일이 없으면 무시
  }
}

// dist/ 의 부모 = 프로젝트 루트
loadEnvFile(path.join(__dirname, '..', '.env'));

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const UPSTREAM = new URL(process.env.UPSTREAM || 'http://localhost:6001');
export const SYNC_TOKEN = process.env.SYNC_TOKEN || crypto.randomBytes(16).toString('hex');
export const DB_PATH = process.env.DB_PATH || 'database/database.bin';
export const MAX_CACHE_SIZE = parseInt(process.env.MAX_CACHE_SIZE || '104857600', 10);
export const MAX_LOG_ENTRIES = parseInt(process.env.MAX_LOG_ENTRIES || '1000', 10);
export const SCRIPT_TAG = '<script defer src="/sync/client.js"></script>';
