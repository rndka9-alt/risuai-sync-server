import type { RisuDatabase } from './types';

/** ROOT safe key 라이브 적용 */
export function applyRootSafeKeys(db: RisuDatabase, rootData: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (rootData[key] !== undefined) {
      db[key] = rootData[key];
    }
  }
}
