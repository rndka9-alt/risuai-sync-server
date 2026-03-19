import type { BlocksChangedMessage } from '../../shared/types';
import { syncFetch } from '../config';
import { state } from '../state';
import { showNotification } from '../notification';
import type { RisuCharacter, RisuDatabase, PluginApis, CharFetchResult, RootFetchResult } from './types';
import { classifyChangedBlocks } from './classifyChangedBlocks';
import { applyRootSafeKeys } from './applyRootSafeKeys';
import { resolveStreamFromDb } from './resolveStreamFromDb';
import { applyStreamText } from './applyStreamText';

declare var __pluginApis__: PluginApis | undefined;

/** 블록 단위 동기화 핸들러 */
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

  const { charBlocks, safeRootBlocks, needsReload: classifiedReload } = classifyChangedBlocks(msg.changed || []);
  let needsReload = classifiedReload;

  // 캐릭터 블록 + safe ROOT 블록 병렬 fetch
  const charFetches: Promise<CharFetchResult>[] = charBlocks.map((b) =>
    syncFetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<RisuCharacter> : null))
      .then((data): CharFetchResult => ({ type: 'char', name: b.name, block: b, data }))
      .catch((): CharFetchResult => ({ type: 'char', name: b.name, block: b, data: null })),
  );

  const rootFetches: Promise<RootFetchResult>[] = safeRootBlocks.map((b) =>
    syncFetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<Record<string, unknown>> : null))
      .then((data): RootFetchResult => ({ type: 'root', name: b.name, block: b, data }))
      .catch((): RootFetchResult => ({ type: 'root', name: b.name, block: b, data: null })),
  );

  Promise.all([...charFetches, ...rootFetches]).then((results) => {
    results.forEach((r) => {
      if (r.type === 'char') {
        if (!r.data) { needsReload = true; return; }
        // 스트리밍 중인 캐릭터는 블록 교체 skip (stream-data가 더 최신)
        const hasActiveStream = [...state.activeStreams.values()]
          .some((s) => s.targetCharId === r.name);
        if (hasActiveStream) return;
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

    // After block sync, handle active streams
    for (const [, stream] of state.activeStreams) {
      if (!stream.resolved) {
        // Try to resolve using isStreaming flag from synced data
        resolveStreamFromDb(stream, db);
      }
      if (stream.resolved && stream.lastText) {
        // Overwrite with latest stream text (more recent than cached block)
        applyStreamText(stream, db);
      }
    }

    if (needsReload) {
      showNotification();
    }
  });
}
