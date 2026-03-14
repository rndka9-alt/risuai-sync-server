/**
 * 런타임 설정 — 서버가 번들 앞에 주입하는 __SYNC_CONFIG__ 에서 읽음
 * @see ../server/client-bundle.ts
 */
interface SyncConfig {
  SYNC_TOKEN: string;
  DB_PATH: string;
}

declare var __SYNC_CONFIG__: SyncConfig;

export const SYNC_TOKEN: string = __SYNC_CONFIG__.SYNC_TOKEN;
export const DB_PATH: string = __SYNC_CONFIG__.DB_PATH;
export const CLIENT_ID: string = Math.random().toString(36).substring(2) + Date.now().toString(36);
