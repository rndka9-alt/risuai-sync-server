import * as logger from '../../logger';
import { dbWriteQueue } from '../../serverState';
import { processDbWrite } from '../processDbWrite';
import { broadcastDbChanged } from '../broadcast';

export function reserveDbWrite(): number {
  return dbWriteQueue.reserve();
}

export function enqueueDbWrite(seq: number, buffer: Buffer, senderClientId: string | null): void {
  dbWriteQueue.enqueue(seq, () => {
    try {
      processDbWrite(buffer, senderClientId);
    } catch (e) {
      logger.error('Error processing DB write (queued)', { error: e instanceof Error ? e.message : String(e) });
      broadcastDbChanged(senderClientId);
    }
  });
}

export function skipDbWrite(seq: number): void {
  dbWriteQueue.skip(seq);
}
