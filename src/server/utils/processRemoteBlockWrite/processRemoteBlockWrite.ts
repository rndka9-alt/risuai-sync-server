import crypto from 'crypto';
import { BLOCK_TYPE } from '../../../shared/blockTypes';
import type { BlockChange, ServerMessage } from '../../../shared/types';
import * as cache from '../../cache';
import * as logger from '../../logger';
import { clients } from '../../serverState';
import { broadcast } from '../broadcast';

/** Remote block write 처리: 해시 비교 → broadcast (Node 서버 모드) */
export function processRemoteBlockWrite(
  buffer: Buffer,
  charId: string,
  senderClientId: string | null,
): void {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const jsonStr = buffer.toString('utf-8');

  try {
    JSON.parse(jsonStr);
  } catch {
    logger.error('Remote block is not valid JSON, skipping', { charId });
    return;
  }

  if (!cache.cacheInitialized) {
    // database.bin 이전에 도착한 경우: 캐시만 채움
    cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
    cache.dataCache.set(charId, jsonStr);
    logger.info('Remote block cached (pre-init)', { charId });
    return;
  }

  const cached = cache.hashCache.get(charId);
  if (cached && cached.hash === hash) {
    return;
  }

  cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
  cache.dataCache.set(charId, jsonStr);

  const blockChange: BlockChange = { name: charId, type: BLOCK_TYPE.WITH_CHAT };
  const isNew = !cached;
  const changed: BlockChange[] = isNew ? [] : [blockChange];
  const added: BlockChange[] = isNew ? [blockChange] : [];

  const version = cache.addChangeLogEntry(changed.concat(added), [], senderClientId);

  logger.info(`v${version}: remote block ${isNew ? 'added' : 'changed'}`, { charId, sender: senderClientId || 'unknown' });

  broadcast(
    { type: 'blocks-changed', epoch: cache.epoch, version, changed, added, deleted: [], timestamp: Date.now() },
    senderClientId,
  );

  if (senderClientId && clients!.has(senderClientId)) {
    const senderWs = clients!.get(senderClientId)!;
    if (senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'version-update', epoch: cache.epoch, version } satisfies ServerMessage));
    }
  }
}
