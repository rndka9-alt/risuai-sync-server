import { state } from '../state';
import type { StreamDataMessage } from '../../shared/types';
import type { PluginApis } from './types';
import { resolveStreamTarget } from './resolveStreamTarget';
import { applyStreamText } from './applyStreamText';

declare var __pluginApis__: PluginApis | undefined;

export function handleStreamData(msg: StreamDataMessage): void {
  const streamState = state.activeStreams.get(msg.streamId);
  if (!streamState) return;

  streamState.lastText = msg.text;

  // Try to resolve if not yet resolved
  if (!streamState.resolved && typeof __pluginApis__ !== 'undefined') {
    try {
      const db = __pluginApis__.getDatabase();
      resolveStreamTarget(streamState, db);
    } catch {
      return;
    }
  }

  if (!streamState.resolved) return;

  try {
    const db = __pluginApis__!.getDatabase();
    applyStreamText(streamState, db);
  } catch {
    // Non-fatal
  }
}
