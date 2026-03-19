import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as config from './config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/client.js — esbuild가 빌드한 클라이언트 번들
const clientBundlePath = path.join(__dirname, 'client.js');
const clientBundle = fs.readFileSync(clientBundlePath, 'utf-8');

/** 번들 content hash — cache-busting용. 서버 시작 시 1회 계산. */
export const clientBundleHash = crypto.createHash('sha256').update(clientBundle).digest('hex').slice(0, 12);

export function buildClientJs(): string {
  // 런타임 설정을 스크립트 앞에 주입 (IIFE 외부 스코프)
  const runtimeConfig = `var __SYNC_CONFIG__=${JSON.stringify({
    DB_PATH: config.DB_PATH,
  })};\n`;
  return runtimeConfig + clientBundle;
}
