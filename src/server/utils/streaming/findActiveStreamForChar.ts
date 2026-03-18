import { activeStreams, type ActiveStream } from '../../serverState';

/** Streaming Protection: proxy2 & write drop 판정 */
export function findActiveStreamForChar(targetCharId: string | null): ActiveStream | null {
  if (!targetCharId) return null;
  for (const stream of activeStreams.values()) {
    if (stream.targetCharId === targetCharId) return stream;
  }
  return null;
}
