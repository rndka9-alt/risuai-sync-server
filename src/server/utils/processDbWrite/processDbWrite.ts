import crypto from 'crypto';
import { parseRisuSaveBlocks } from '../../parser';
import { BLOCK_TYPE } from '../../../shared/blockTypes';
import type { BlockChange } from '../../../shared/types';
import * as cache from '../../cache';
import * as logger from '../../logger';
import { clientRootCache } from '../../serverState';
import { broadcast, broadcastDbChanged, broadcastPlainFetchWarning } from '../broadcast';
import { isClientFresh } from '../freshness';
import { notifySenderVersion } from '../notifySenderVersion';
import { diffRootKeys } from './utils/diffRootKeys';
import { diffDirectory } from './utils/diffDirectory';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** DB write 처리: 파싱 → 해시 비교 → broadcast */
export function processDbWrite(buffer: Buffer, senderClientId: string | null): void {
  const parsed = parseRisuSaveBlocks(buffer);
  if (!parsed) {
    // 파싱 실패 → Phase 1 fallback
    broadcastDbChanged(senderClientId);
    return;
  }

  const { blocks, directory } = parsed;

  if (!cache.cacheInitialized) {
    // 첫 write: 캐시만 채움, broadcast 없음
    for (const [name, block] of blocks) {
      cache.hashCache.set(name, { type: block.type, hash: block.hash });
      try {
        cache.dataCache.set(name, JSON.parse(block.json));
      } catch {
        cache.dataCache.set(name, block.json);
      }
    }
    cache.setCacheInitialized(true);
    logger.info(`Cache initialized with ${blocks.size} blocks`);
    checkAndBroadcastPlainFetch(blocks);
    return;
  }

  const changed: BlockChange[] = [];
  const added: BlockChange[] = [];
  const deleted: string[] = [];

  for (const [name, block] of blocks) {
    const cached = cache.hashCache.get(name);
    if (!cached) {
      added.push({ name, type: block.type });
    } else if (cached.hash !== block.hash) {
      // ROOT 블록: 3분류 필터링
      if (block.type === BLOCK_TYPE.ROOT) {
        const globalOldObj = cache.dataCache.get(name);
        let newObj: unknown;
        try { newObj = JSON.parse(block.json); } catch { newObj = null; }
        const globalDiff = diffRootKeys(globalOldObj, newObj);

        // __directory 비교: 캐릭터 추가/삭제 감지.
        // - 추가: 글로벌 캐시 기준 (새 캐릭터 감지)
        // - 삭제: sender의 이전 __directory 기준 (false delete 방지)
        //   → sender가 아직 수신하지 못한 항목을 "삭제"로 오판하는 것을 차단
        const blockNames = new Set(blocks.keys());
        const globalDirDiff = diffDirectory(globalOldObj, newObj, blockNames);
        if (globalDirDiff) {
          for (const entry of globalDirDiff.added) {
            added.push({ name: entry, type: BLOCK_TYPE.WITHOUT_CHAT });
          }
        }
        // Stale 클라이언트의 __directory 기반 삭제를 차단:
        // 오래된 __directory로 최근 추가된 캐릭터를 "삭제됨"으로 오판하는 것을 방지
        const senderOldRootObj = senderClientId ? clientRootCache.get(senderClientId) : undefined;
        if (senderOldRootObj && isClientFresh(senderClientId)) {
          const senderDirDiff = diffDirectory(senderOldRootObj, newObj, blockNames);
          if (senderDirDiff) {
            for (const entry of senderDirDiff.deleted) {
              deleted.push(entry);
              cache.hashCache.delete(entry);
              cache.dataCache.delete(entry);
            }
          }
        }

        // ROOT 변경 상세 debug 로깅
        if (globalDiff && globalDiff.syncedKeys.includes('pluginCustomStorage') && isRecord(globalOldObj) && isRecord(newObj)) {
          const oldPcs = isRecord(globalOldObj.pluginCustomStorage) ? globalOldObj.pluginCustomStorage : {};
          const newPcs = isRecord(newObj.pluginCustomStorage) ? newObj.pluginCustomStorage : {};
          logger.diffObjects('pluginCustomStorage', oldPcs, newPcs);
        }

        // Per-client intersection diff: 글로벌 diff와 클라이언트 diff의 교집합만 broadcast.
        const clientOldObj = senderClientId ? clientRootCache.get(senderClientId) : undefined;
        const clientDiff = clientOldObj ? diffRootKeys(clientOldObj, newObj) : null;

        if (globalDiff && clientDiff) {
          const clientSyncedSet = new Set(clientDiff.syncedKeys);
          const clientUnknownSet = new Set(clientDiff.unknownKeys);
          const effectiveSynced = globalDiff.syncedKeys.filter((k) => clientSyncedSet.has(k));
          const effectiveUnknown = globalDiff.unknownKeys.filter((k) => clientUnknownSet.has(k));

          if (effectiveSynced.length > 0 || effectiveUnknown.length > 0) {
            const entry: BlockChange = { name, type: block.type };
            entry.changedKeys = [...effectiveSynced, ...effectiveUnknown];
            entry.hasUnknownKeys = effectiveUnknown.length > 0;
            changed.push(entry);
          }
        } else if (globalDiff) {
          // per-client 캐시 없음 (첫 write) → 글로벌 diff fallback
          if (!globalDiff.ignoredOnly) {
            const entry: BlockChange = { name, type: block.type };
            entry.changedKeys = [...globalDiff.syncedKeys, ...globalDiff.unknownKeys];
            entry.hasUnknownKeys = globalDiff.unknownKeys.length > 0;
            changed.push(entry);
          }
        } else if (!globalDiff) {
          // diff 실패 (null) → 전체 reload fallback
          const entry: BlockChange = { name, type: block.type };
          entry.changedKeys = null;
          entry.hasUnknownKeys = true;
          changed.push(entry);
        }
      } else {
        changed.push({ name, type: block.type });
      }
    }
    // 캐시는 항상 업데이트 (IGNORED-only 변경도 포함)
    cache.hashCache.set(name, { type: block.type, hash: block.hash });
    let parsed: unknown;
    try { parsed = JSON.parse(block.json); } catch { parsed = block.json; }
    cache.dataCache.set(name, parsed);
    if (block.type === BLOCK_TYPE.ROOT && senderClientId) {
      clientRootCache.set(senderClientId, parsed);
    }
  }

  if (changed.length === 0 && added.length === 0 && deleted.length === 0) {
    return;
  }

  const version = cache.addChangeLogEntry(changed.concat(added), deleted, senderClientId);

  logger.info(`v${version}: ${changed.length} changed, ${added.length} added, ${deleted.length} deleted`, {
    sender: senderClientId || 'unknown',
  });
  for (const c of changed) {
    logger.debug('changed', {
      name: c.name,
      type: String(c.type),
      changedKeys: c.changedKeys ? JSON.stringify(c.changedKeys) : 'all',
    });
  }
  for (const a of added) {
    logger.debug('added', { name: a.name, type: String(a.type) });
  }
  for (const d of deleted) {
    logger.debug('deleted', { name: d });
  }

  broadcast(
    { type: 'blocks-changed', epoch: cache.epoch, version, changed, added, deleted, timestamp: Date.now() },
    senderClientId,
  );

  // sender에게는 version만 알림 (catch-up 시 자기 변경분을 다시 받지 않도록)
  notifySenderVersion(senderClientId, version);

  checkAndBroadcastPlainFetch(blocks);
}

function checkAndBroadcastPlainFetch(blocks: Map<string, { type: number; json: string; hash: string }>): void {
  const rootBlock = blocks.get('root');
  if (!rootBlock) return;
  try {
    const root: unknown = JSON.parse(rootBlock.json);
    if (isRecord(root) && root.usePlainFetch === true) {
      broadcastPlainFetchWarning();
    }
  } catch { /* ignore */ }
}
