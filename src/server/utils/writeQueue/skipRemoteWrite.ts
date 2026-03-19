import { remoteWriteQueues } from '../../serverState';

export function skipRemoteWrite(seq: number, charId: string): void {
  const queue = remoteWriteQueues.get(charId);
  if (queue) queue.skip(seq);
}
