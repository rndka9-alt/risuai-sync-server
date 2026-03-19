import type { StreamEndMessage } from '../../../shared/types';
import { broadcast } from './broadcast';

/** Non-SSE 응답 완료 시 stream-end 브로드캐스트 (activeStreams 미경유) */
export function broadcastResponseCompleted(
  streamId: string,
  senderClientId: string,
  targetCharId: string | null,
  text: string,
): void {
  if (!text) return;
  const endMsg: StreamEndMessage = {
    type: 'stream-end',
    streamId,
    targetCharId,
    text,
    timestamp: Date.now(),
  };
  broadcast(endMsg, senderClientId);
}
