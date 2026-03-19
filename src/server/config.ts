import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

if (!process.env.UPSTREAM) {
  throw new Error('UPSTREAM env is required (e.g. http://risuai:6001)');
}
export const UPSTREAM = new URL(process.env.UPSTREAM);
export const DB_PATH = process.env.DB_PATH || 'database/database.bin';
export const MAX_CACHE_SIZE = parseInt(process.env.MAX_CACHE_SIZE || '104857600', 10);
export const MAX_LOG_ENTRIES = parseInt(process.env.MAX_LOG_ENTRIES || '1000', 10);
export const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
export const RETRY_MAX_ATTEMPTS = parseInt(process.env.RETRY_MAX_ATTEMPTS || '2', 10);
export const RETRY_BASE_DELAY_MS = parseInt(process.env.RETRY_BASE_DELAY_MS || '500', 10);
/**
 * SCRIPT_TAG는 서버 시작 후 client-bundle의 hash가 계산된 뒤 getScriptTag()로 사용.
 * 정적 export 대신 함수로 제공하여 순환 의존 방지.
 */
export function getScriptTag(bundleHash: string): string {
  return `<script defer src="/sync/client.js?v=${bundleHash}"></script>`;
}

export {
  CLIENT_ID_HEADER,
  FILE_PATH_HEADER,
  REQUEST_ID_HEADER,
  PROXY2_TARGET_HEADER,
  RISU_AUTH_HEADER,
} from '../shared/headers';
