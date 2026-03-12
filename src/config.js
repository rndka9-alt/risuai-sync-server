'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// .env 파서 (dotenv 의존성 없음)
// ---------------------------------------------------------------------------
function loadEnvFile(filePath) {
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

// src/ 의 부모 = sync/ 디렉토리
loadEnvFile(path.join(__dirname, '..', '.env'));

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  UPSTREAM: new URL(process.env.UPSTREAM || 'http://localhost:6001'),
  SYNC_TOKEN: process.env.SYNC_TOKEN || crypto.randomBytes(16).toString('hex'),
  DB_PATH: process.env.DB_PATH || 'database/database.bin',
  MAX_CACHE_SIZE: parseInt(process.env.MAX_CACHE_SIZE || '104857600', 10),
  MAX_LOG_ENTRIES: parseInt(process.env.MAX_LOG_ENTRIES || '1000', 10),
  SCRIPT_TAG: '<script defer src="/sync/client.js"></script>',
};
