import { isSyncedRootKey, isIgnoredRootKey } from '../../../../shared/blockTypes';

export interface DiffRootResult {
  syncedKeys: string[];   // SYNCED_ROOT_KEYS에 있는 변경 키
  unknownKeys: string[];  // 어디에도 없는 키 → reload 유도
  ignoredOnly: boolean;   // 변경이 전부 IGNORED 키뿐인지
}

export function diffRootKeys(oldJson: string | null, newJson: string): DiffRootResult | null {
  if (!oldJson || !newJson) return null;
  try {
    const oldObj = JSON.parse(oldJson);
    const newObj = JSON.parse(newJson);
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj),
    ]);
    const syncedKeys: string[] = [];
    const unknownKeys: string[] = [];
    let hasIgnored = false;
    for (const key of allKeys) {
      if (key.startsWith('__')) continue; // __directory 등 메타 키 무시
      if (JSON.stringify(oldObj[key]) !== JSON.stringify(newObj[key])) {
        if (isSyncedRootKey(key)) {
          syncedKeys.push(key);
        } else if (isIgnoredRootKey(key)) {
          hasIgnored = true;
        } else {
          unknownKeys.push(key);
        }
      }
    }
    const ignoredOnly = syncedKeys.length === 0 && unknownKeys.length === 0 && hasIgnored;
    return { syncedKeys, unknownKeys, ignoredOnly };
  } catch {
    return null; // 파싱 실패 시 null → 클라이언트에서 reload fallback
  }
}
