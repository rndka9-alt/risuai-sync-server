import { dbWriteQueue } from '../../serverState';

export function skipDbWrite(seq: number): void {
  dbWriteQueue.skip(seq);
}
