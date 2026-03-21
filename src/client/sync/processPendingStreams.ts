import type { PendingStream } from '../../shared/types';
import { applyFinalText } from './utils/applyFinalText';

/** 보관소: 미수신 완료 스트림 일괄 처리 */
export function processPendingStreams(pendingStreams: ReadonlyArray<PendingStream>): void {
  for (const pending of pendingStreams) {
    if (pending.text && pending.targetCharId) {
      applyFinalText(pending.targetCharId, pending.text, undefined);
    }
  }
}
