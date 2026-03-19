import { remoteWriteQueues } from '../../serverState';
import { WriteOrderQueue } from '../../write-order-queue';

export function reserveRemoteWrite(charId: string): number {
  let queue = remoteWriteQueues.get(charId);
  if (!queue) {
    queue = new WriteOrderQueue();
    remoteWriteQueues.set(charId, queue);
  }
  return queue.reserve();
}
