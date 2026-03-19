import type { StreamState } from '../../state';
import type { PluginApis } from '../types';
import { applyStreamText } from '../applyStreamText';
import { resolveStreamTarget } from '../resolveStreamTarget';
import { finalizeStream } from './finalizeStream';

declare var __pluginApis__: PluginApis | undefined;

/** 최종 텍스트 적용 + isStreaming 해제 */
export function applyFinalText(
  targetCharId: string,
  text: string,
  existingState: StreamState | undefined,
): void {
  if (typeof __pluginApis__ === 'undefined') return;
  try {
    const db = __pluginApis__.getDatabase();

    if (existingState?.resolved) {
      existingState.lastText = text;
      applyStreamText(existingState, db);
      finalizeStream(existingState);
      return;
    }

    // resolved 안 된 경우 → 임시 StreamState로 resolve 시도
    const tempState: StreamState = {
      streamId: '',
      targetCharId,
      targetCharIndex: -1,
      targetChatIndex: -1,
      targetMsgIndex: -1,
      resolved: false,
      lastText: text,
    };
    if (resolveStreamTarget(tempState, db)) {
      applyStreamText(tempState, db);
      finalizeStream(tempState);
    }
  } catch {
    // Non-fatal
  }
}
