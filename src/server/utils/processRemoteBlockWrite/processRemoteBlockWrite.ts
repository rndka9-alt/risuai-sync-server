import crypto from 'crypto';
import { BLOCK_TYPE } from '../../../shared/blockTypes';
import type { BlockChange } from '../../../shared/types';
import * as cache from '../../cache';
import * as logger from '../../logger';
import { broadcast } from '../broadcast';
import { notifySenderVersion } from '../notifySenderVersion';

/** Remote block write 처리: 해시 비교 → broadcast (Node 서버 모드) */
export function processRemoteBlockWrite(
  buffer: Buffer,
  charId: string,
  senderClientId: string | null,
): void {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const jsonStr = buffer.toString('utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error('Remote block is not valid JSON, skipping', { charId });
    return;
  }

  if (!cache.cacheInitialized) {
    cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
    cache.dataCache.set(charId, parsed);
    logger.info('Remote block cached (pre-init)', { charId });
    return;
  }

  const cached = cache.hashCache.get(charId);
  if (cached && cached.hash === hash) {
    return;
  }

  cache.hashCache.set(charId, { type: BLOCK_TYPE.WITH_CHAT, hash });
  cache.dataCache.set(charId, parsed);

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

  notifySenderVersion(senderClientId, version);
}
