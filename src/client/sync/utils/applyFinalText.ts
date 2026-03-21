import type { StreamState } from '../../state';
import type { PluginApis } from '../types';
import { applyStreamText } from '../applyStreamText';
import { resolveStreamTarget } from '../resolveStreamTarget';
import { finalizeStream } from './finalizeStream';

declare var __pluginApis__: PluginApis | undefined;

/** 최종 텍스트 적용 + isStreaming 해제. 성공 시 true 반환 */
export function applyFinalText(
  targetCharId: string,
  text: string,
  existingState: StreamState | undefined,
): boolean {
  if (typeof __pluginApis__ === 'undefined') return false;
  try {
    const db = __pluginApis__.getDatabase();

    if (existingState?.resolved) {
      existingState.lastText = text;
      applyStreamText(existingState, db);
      finalizeStream(existingState);
      return true;
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
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
