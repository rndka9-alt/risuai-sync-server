import { state } from '../state';
import type { StreamState } from '../state';
import type { StreamStartMessage } from '../../shared/types';
import type { PluginApis } from './types';
import { resolveStreamTarget } from './resolveStreamTarget';

declare var __pluginApis__: PluginApis | undefined;

export function handleStreamStart(msg: StreamStartMessage): void {
  const streamState: StreamState = {
    streamId: msg.streamId,
    targetCharId: msg.targetCharId,
    targetCharIndex: -1,
    targetChatIndex: -1,
    targetMsgIndex: -1,
    resolved: false,
    lastText: '',
  };

  // Try to resolve immediately using hint
  if (msg.targetCharId && typeof __pluginApis__ !== 'undefined') {
    try {
      const db = __pluginApis__.getDatabase();
      resolveStreamTarget(streamState, db);
    } catch {
      // Non-fatal
    }
  }

  state.activeStreams.set(msg.streamId, streamState);
}
