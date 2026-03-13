// ---------------------------------------------------------------------------
// RisuSave 블록 타입 상수 & 동기화 상수
// 서버 + 클라이언트 공통 모듈
// ---------------------------------------------------------------------------
// 0: CONFIG       – 설정 데이터
// 1: ROOT         – 최상위 DB 블록 (__directory, enabledModules 등)
// 2: WITH_CHAT    – 캐릭터 카드 (채팅 포함)
// 6: REMOTE       – 원격 블록 (Phase 1 fallback 대상)
// 7: WITHOUT_CHAT – 캐릭터 카드 (채팅 미포함)
// ---------------------------------------------------------------------------
export const BLOCK_TYPE = {
  CONFIG: 0,
  ROOT: 1,
  WITH_CHAT: 2,
  REMOTE: 6,
  WITHOUT_CHAT: 7,
} as const;

export type BlockType = (typeof BLOCK_TYPE)[keyof typeof BLOCK_TYPE];

const BLOCK_TYPE_VALUES: ReadonlySet<number> = new Set(Object.values(BLOCK_TYPE));

export function isBlockType(value: number): value is BlockType {
  return BLOCK_TYPE_VALUES.has(value);
}

// ---------------------------------------------------------------------------
// 라이브 적용 가능한 ROOT 키 화이트리스트
// ---------------------------------------------------------------------------
export const SAFE_ROOT_KEYS = ['enabledModules'] as const;

export type SafeRootKey = (typeof SAFE_ROOT_KEYS)[number];

const SAFE_ROOT_KEY_SET: ReadonlySet<string> = new Set(SAFE_ROOT_KEYS);

export function isSafeRootKey(key: string): boolean {
  return SAFE_ROOT_KEY_SET.has(key);
}
