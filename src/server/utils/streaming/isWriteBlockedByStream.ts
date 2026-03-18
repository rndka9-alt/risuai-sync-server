import { activeStreams } from '../../serverState';

export function isWriteBlockedByStream(senderClientId: string | null): boolean {
  if (activeStreams.size === 0) return false;
  for (const stream of activeStreams.values()) {
    if (stream.senderClientId !== senderClientId) return true;
  }
  return false;
}
