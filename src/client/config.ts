/**
 * 런타임 설정 — 서버가 번들 앞에 주입하는 __SYNC_CONFIG__ 에서 읽음
 * @see {@link import("../server/client-bundle").buildClientJs}
 */
interface SyncConfig {
  DB_PATH: string;
}

declare var __SYNC_CONFIG__: SyncConfig;

export const DB_PATH: string = __SYNC_CONFIG__.DB_PATH;
export const CLIENT_ID: string = Math.random().toString(36).substring(2) + Date.now().toString(36);

export { CLIENT_ID_HEADER, FILE_PATH_HEADER, PROXY2_TARGET_HEADER, RISU_AUTH_HEADER } from '../shared/headers';

import { getToken } from './auth';
import { RISU_AUTH_HEADER } from '../shared/headers';

/** 인증이 필요한 /sync/* 엔드포인트용 fetch wrapper */
export function syncFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) {
    headers.set(RISU_AUTH_HEADER, token);
  }
  return fetch(url, { ...init, headers });
}
