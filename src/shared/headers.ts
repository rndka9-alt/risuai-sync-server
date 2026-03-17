/**
 * Project-specific custom HTTP headers.
 * Shared between server and client — keep in sync.
 *
 * Standard headers (content-type, host, etc.) are NOT included here.
 */

/** 프록시 모듈 간 공유하는 클라이언트 식별 헤더 */
export const CLIENT_ID_HEADER = 'x-proxy-client-id';
export const FILE_PATH_HEADER = 'file-path';
export const REQUEST_ID_HEADER = 'x-request-id';
export const PROXY2_TARGET_HEADER = 'x-sync-proxy2-target-char';
export const RISU_AUTH_HEADER = 'risu-auth';
