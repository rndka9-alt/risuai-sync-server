import * as logger from '../../logger';
import { remoteWriteQueues } from '../../serverState';
import { WriteOrderQueue } from '../../write-order-queue';
import { processRemoteBlockWrite } from '../processRemoteBlockWrite';
import { broadcastDbChanged } from '../broadcast';

export function reserveRemoteWrite(charId: string): number {
  let queue = remoteWriteQueues.get(charId);
  if (!queue) {
    queue = new WriteOrderQueue();
    remoteWriteQueues.set(charId, queue);
  }
  return queue.reserve();
}

export function enqueueRemoteWrite(
  seq: number,
  charId: string,
  buffer: Buffer,
  senderClientId: string | null,
): void {
  const queue = remoteWriteQueues.get(charId);
  if (!queue) return;
  queue.enqueue(seq, () => {
    try {
      processRemoteBlockWrite(buffer, charId, senderClientId);
    } catch (e) {
      logger.error('Error processing remote block write (queued)', { error: e instanceof Error ? e.message : String(e) });
      broadcastDbChanged(senderClientId);
    }
  });
}

export function skipRemoteWrite(seq: number, charId: string): void {
  const queue = remoteWriteQueues.get(charId);
  if (queue) queue.skip(seq);
}
