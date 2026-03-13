import { BLOCK_TYPE, isSafeRootKey } from '../shared/blockTypes';
import type { BlockChange, BlocksChangedMessage, ChangesResponse, ChangeLogEntry } from '../shared/types';
import { CLIENT_ID } from './config';
import { state } from './state';
import { showNotification } from './notification';

// ---------------------------------------------------------------------------
// RisuAI 플러그인 API 타입
// ---------------------------------------------------------------------------
interface RisuCharacter {
  chaId: string;
  [key: string]: unknown;
}

interface RisuDatabase {
  characters: RisuCharacter[];
  [key: string]: unknown;
}

interface PluginApis {
  getDatabase(): RisuDatabase;
}

declare var __pluginApis__: PluginApis | undefined;

// ---------------------------------------------------------------------------
// Catch-up: 놓친 변경분 복구
// ---------------------------------------------------------------------------
export function catchUpFromServer(): void {
  fetch('/sync/changes?since=' + state.lastVersion + '&clientId=' + encodeURIComponent(CLIENT_ID))
    .then((r) => {
      if (r.status === 410) {
        showNotification();
        return null;
      }
      return r.json() as Promise<ChangesResponse>;
    })
    .then((data) => {
      if (!data) return;
      if (!data.changes || !data.changes.length) {
        state.lastVersion = data.currentVersion;
        return;
      }
      state.lastVersion = data.currentVersion;

      // 블록별 마지막 operation 추적 (changed vs deleted)
      const lastOp: Record<string, { op: 'changed'; block: BlockChange } | { op: 'deleted' }> = {};
      data.changes.forEach((entry: ChangeLogEntry) => {
        (entry.changed || []).forEach((b) => {
          lastOp[b.name] = { op: 'changed', block: b };
        });
        (entry.deleted || []).forEach((name) => {
          lastOp[name] = { op: 'deleted' };
        });
      });

      const allChanged: BlockChange[] = [];
      const allDeleted: string[] = [];
      Object.keys(lastOp).forEach((name) => {
        const entry = lastOp[name];
        if (entry.op === 'changed') {
          allChanged.push(entry.block);
        } else {
          allDeleted.push(name);
        }
      });

      handleBlocksChanged({
        type: 'blocks-changed',
        version: data.currentVersion,
        changed: allChanged,
        added: [],
        deleted: allDeleted,
        timestamp: Date.now(),
      });
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// ROOT 블록의 safe key만 변경되었는지 확인
// ---------------------------------------------------------------------------
function isRootSafeChange(block: BlockChange): boolean {
  if (!block.changedKeys || !Array.isArray(block.changedKeys)) return false;
  if (block.changedKeys.length === 0) return false;
  return block.changedKeys.every(isSafeRootKey);
}

// ---------------------------------------------------------------------------
// ROOT safe key 라이브 적용
// ---------------------------------------------------------------------------
function applyRootSafeKeys(db: RisuDatabase, rootData: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (rootData[key] !== undefined) {
      db[key] = rootData[key];
    }
  }
}

// ---------------------------------------------------------------------------
// fetch 결과 타입
// ---------------------------------------------------------------------------
type CharFetchResult = { type: 'char'; name: string; block: BlockChange; data: RisuCharacter | null };
type RootFetchResult = { type: 'root'; name: string; block: BlockChange; data: Record<string, unknown> | null };

// ---------------------------------------------------------------------------
// 블록 단위 동기화 핸들러
// ---------------------------------------------------------------------------
export function handleBlocksChanged(msg: BlocksChangedMessage): void {
  // 캐릭터 추가/삭제 → 새로고침 (목록 갱신, 대용량 카드 등 고려)
  if ((msg.added && msg.added.length) || (msg.deleted && msg.deleted.length)) {
    showNotification();
    return;
  }

  if (!__pluginApis__) {
    showNotification();
    return;
  }

  let db: RisuDatabase;
  try {
    db = __pluginApis__.getDatabase();
  } catch {
    showNotification();
    return;
  }

  let needsReload = false;

  // 기존 캐릭터 수정만 블록 동기화 (type 2=WITH_CHAT, 7=WITHOUT_CHAT)
  const charBlocks = (msg.changed || [])
    .filter((b) => b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT);

  // ROOT 블록 중 safe key만 변경된 것 분류
  const safeRootBlocks: BlockChange[] = [];

  (msg.changed || []).forEach((b) => {
    if (b.type === BLOCK_TYPE.CONFIG) return;
    if (b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT) return;
    if (b.type === BLOCK_TYPE.ROOT && isRootSafeChange(b)) {
      safeRootBlocks.push(b);
      return;
    }
    // 그 외 (unsafe ROOT, BOTPRESET, MODULES 등) → reload
    needsReload = true;
  });

  // 캐릭터 블록 + safe ROOT 블록 병렬 fetch
  const charFetches: Promise<CharFetchResult>[] = charBlocks.map((b) =>
    fetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<RisuCharacter> : null))
      .then((data): CharFetchResult => ({ type: 'char', name: b.name, block: b, data }))
      .catch((): CharFetchResult => ({ type: 'char', name: b.name, block: b, data: null })),
  );

  const rootFetches: Promise<RootFetchResult>[] = safeRootBlocks.map((b) =>
    fetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<Record<string, unknown>> : null))
      .then((data): RootFetchResult => ({ type: 'root', name: b.name, block: b, data }))
      .catch((): RootFetchResult => ({ type: 'root', name: b.name, block: b, data: null })),
  );

  Promise.all([...charFetches, ...rootFetches]).then((results) => {
    results.forEach((r) => {
      if (r.type === 'char') {
        if (!r.data) { needsReload = true; return; }
        const idx = db.characters.findIndex((c) => c.chaId === r.name);
        if (idx !== -1) {
          db.characters[idx] = r.data;
        } else {
          needsReload = true;
        }
      } else if (r.type === 'root') {
        if (!r.data) { needsReload = true; return; }
        applyRootSafeKeys(db, r.data, r.block.changedKeys!);
      }
    });

    if (needsReload) {
      showNotification();
    }
  });
}
