/**
 * Sync 스트리밍 캡처 플러그인 상수.
 * 서버(플러그인 주입 + 마커 제거) + 클라이언트(마커 감지) 공유.
 */

/** bodyIntercepter가 LLM 요청 body에 삽입하는 마커 키 */
export const SYNC_MARKER_KEY = '__risu_sync_meta__';

/** RisuAI V3 플러그인 이름 (db.plugins 식별자) */
export const SYNC_PLUGIN_NAME = '[Proxy::sync] capture-streaming';
