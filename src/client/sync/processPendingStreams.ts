import type { PendingStream } from '../../shared/types';
import { applyFinalText } from './utils/applyFinalText';
import { sendAck } from './utils/sendAck';

/** 보관소: 미수신 완료 스트림 일괄 처리 */
export function processPendingStreams(pendingStreams: ReadonlyArray<PendingStream>): void {
  for (const pending of pendingStreams) {
    const applied = pending.text && pending.targetCharId
      ? applyFinalText(pending.targetCharId, pending.text, undefined)
      : false;

    if (applied) {
      sendAck(pending.id);
    }
  }
}
