import type { ServerMessage, StreamEndMessage } from '../../../shared/types';
import { clients } from '../../serverState';
import * as config from '../../config';

export function broadcast(payload: ServerMessage, excludeClientId: string | null): void {
  const data = JSON.stringify(payload);
  for (const [id, client] of clients) {
    if (id !== excludeClientId && client.readyState === 1) {
      client.send(data);
    }
  }
}

export function broadcastDbChanged(excludeClientId: string | null): void {
  broadcast(
    { type: 'db-changed', file: config.DB_PATH, timestamp: Date.now() },
    excludeClientId,
  );
}

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
