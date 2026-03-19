import { dbWriteQueue } from '../../serverState';

export function reserveDbWrite(): number {
  return dbWriteQueue.reserve();
}
