import { BLOCK_TYPE, isSyncedRootKey } from '../shared/blockTypes';
import type { BlockChange, BlocksChangedMessage, ChangesResponse, ChangeLogEntry, PendingStream, StreamStartMessage, StreamDataMessage, StreamEndMessage } from '../shared/types';
import { CLIENT_ID, syncFetch } from './config';
import { state } from './state';
import type { StreamState } from './state';
import { showNotification } from './notification';

/**
 * Plugin API가 실제로 DB에 쓸 수 있는 키 (RisuAI allowedDbKeys 미러).
 *
 * __pluginApis__.getDatabase()는 Proxy 객체를 반환하며,
 * 읽기/쓰기 모두 이 목록에 없는 키는 pluginCustomStorage로 리다이렉트된다.
 * Object.keys(db)도 이 목록에 해당하는 키만 반환한다.
 *
 * 따라서 이 목록에 없는 ROOT 키의 변경 감지는
 * 클라이언트에서 불가능하며, 서버 측 글로벌 diff로만 가능하다.
 */
const PLUGIN_WRITABLE_KEYS: ReadonlySet<string> = new Set([
  'characters', 'modules', 'enabledModules', 'moduleIntergration',
  'pluginV2', 'personas', 'plugins', 'pluginCustomStorage',
  'temperature', 'askRemoval', 'maxContext', 'maxResponse',
  'frequencyPenalty', 'PresensePenalty', 'theme', 'textTheme',
  'lineHeight', 'seperateModelsForAxModels', 'seperateModels',
  'customCSS', 'guiHTML', 'colorSchemeName', 'selectedPersona',
  'characterOrder',
]);

/** RisuAI 플러그인 API 타입 */
interface RisuCharacter {
  chaId: string;
  [key: string]: unknown;
}

interface RisuDatabase {
  characters: RisuCharacter[];
  [key: string]: unknown;
}

interface PluginApis {
  getDatabase(): RisuDatabase;
}

declare var __pluginApis__: PluginApis | undefined;

/** Catch-up: 놓친 변경분 복구 */
export function catchUpFromServer(): void {
  syncFetch('/sync/changes?since=' + state.lastVersion + '&clientId=' + encodeURIComponent(CLIENT_ID))
    .then((r) => {
      if (r.status === 410) {
        showNotification();
        return null;
      }
      return r.json() as Promise<ChangesResponse>;
    })
    .then((data) => {
      if (!data) return;
      if (state.epoch && state.epoch !== data.epoch) {
        showNotification();
        return;
      }
      state.epoch = data.epoch;
      if (!data.changes || !data.changes.length) {
        state.lastVersion = data.version;
        return;
      }
      state.lastVersion = data.version;

      // 블록별 마지막 operation 추적 (changed vs deleted)
      const lastOp: Record<string, { op: 'changed'; block: BlockChange } | { op: 'deleted' }> = {};
      data.changes.forEach((entry: ChangeLogEntry) => {
        (entry.changed || []).forEach((b) => {
          lastOp[b.name] = { op: 'changed', block: b };
        });
        (entry.deleted || []).forEach((name) => {
          lastOp[name] = { op: 'deleted' };
        });
      });

      const allChanged: BlockChange[] = [];
      const allDeleted: string[] = [];
      Object.keys(lastOp).forEach((name) => {
        const entry = lastOp[name];
        if (entry.op === 'changed') {
          allChanged.push(entry.block);
        } else {
          allDeleted.push(name);
        }
      });

      handleBlocksChanged({
        type: 'blocks-changed',
        epoch: data.epoch,
        version: data.version,
        changed: allChanged,
        added: [],
        deleted: allDeleted,
        timestamp: Date.now(),
      });

      // 보관소: 미수신 완료 스트림 처리
      if (data.pendingStreams && data.pendingStreams.length > 0) {
        processPendingStreams(data.pendingStreams);
      }
    })
    .catch(() => {});
}

/**
 * ROOT 블록이 live-apply 가능한지 확인.
 * changedKeys가 모두 SYNCED이고 unknown 키 없음 → safe
 */
export function isRootSafeChange(block: BlockChange): boolean {
  if (!block.changedKeys || !Array.isArray(block.changedKeys)) return false;
  if (block.changedKeys.length === 0) return false;
  if (block.hasUnknownKeys) return false;
  return block.changedKeys.every(isSyncedRootKey);
}

/** ROOT safe key 라이브 적용 */
export function applyRootSafeKeys(db: RisuDatabase, rootData: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (rootData[key] !== undefined) {
      db[key] = rootData[key];
    }
  }
}

/** fetch 결과 타입 */
type CharFetchResult = { type: 'char'; name: string; block: BlockChange; data: RisuCharacter | null };
type RootFetchResult = { type: 'root'; name: string; block: BlockChange; data: Record<string, unknown> | null };

/** changed 블록을 캐릭터/safeRoot/reload로 분류 */
export function classifyChangedBlocks(changed: BlockChange[]): {
  charBlocks: BlockChange[];
  safeRootBlocks: BlockChange[];
  needsReload: boolean;
} {
  const charBlocks = changed
    .filter((b) => b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT);

  const safeRootBlocks: BlockChange[] = [];
  let needsReload = false;

  changed.forEach((b) => {
    if (b.type === BLOCK_TYPE.CONFIG || b.type === BLOCK_TYPE.BOTPRESET || b.type === BLOCK_TYPE.MODULES) return;
    if (b.type === BLOCK_TYPE.WITH_CHAT || b.type === BLOCK_TYPE.WITHOUT_CHAT) return;
    if (b.type === BLOCK_TYPE.ROOT && isRootSafeChange(b)) {
      if (b.changedKeys!.every((k) => PLUGIN_WRITABLE_KEYS.has(k))) {
        safeRootBlocks.push(b);
      } else {
        needsReload = true;
      }
      return;
    }
    // 그 외 (unsafe ROOT 등) → reload
    needsReload = true;
  });

  return { charBlocks, safeRootBlocks, needsReload };
}

/** 블록 단위 동기화 핸들러 */
export function handleBlocksChanged(msg: BlocksChangedMessage): void {
  // 캐릭터 추가/삭제 → 새로고침 (목록 갱신, 대용량 카드 등 고려)
  if ((msg.added && msg.added.length) || (msg.deleted && msg.deleted.length)) {
    showNotification();
    return;
  }

  if (!__pluginApis__) {
    showNotification();
    return;
  }

  let db: RisuDatabase;
  try {
    db = __pluginApis__.getDatabase();
  } catch {
    showNotification();
    return;
  }

  const { charBlocks, safeRootBlocks, needsReload: classifiedReload } = classifyChangedBlocks(msg.changed || []);
  let needsReload = classifiedReload;

  // 캐릭터 블록 + safe ROOT 블록 병렬 fetch
  const charFetches: Promise<CharFetchResult>[] = charBlocks.map((b) =>
    syncFetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<RisuCharacter> : null))
      .then((data): CharFetchResult => ({ type: 'char', name: b.name, block: b, data }))
      .catch((): CharFetchResult => ({ type: 'char', name: b.name, block: b, data: null })),
  );

  const rootFetches: Promise<RootFetchResult>[] = safeRootBlocks.map((b) =>
    syncFetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then((r) => (r.ok ? r.json() as Promise<Record<string, unknown>> : null))
      .then((data): RootFetchResult => ({ type: 'root', name: b.name, block: b, data }))
      .catch((): RootFetchResult => ({ type: 'root', name: b.name, block: b, data: null })),
  );

  Promise.all([...charFetches, ...rootFetches]).then((results) => {
    results.forEach((r) => {
      if (r.type === 'char') {
        if (!r.data) { needsReload = true; return; }
        // 스트리밍 중인 캐릭터는 블록 교체 skip (stream-data가 더 최신)
        const hasActiveStream = [...state.activeStreams.values()]
          .some((s) => s.targetCharId === r.name);
        if (hasActiveStream) return;
        const idx = db.characters.findIndex((c) => c.chaId === r.name);
        if (idx !== -1) {
          db.characters[idx] = r.data;
        } else {
          needsReload = true;
        }
      } else if (r.type === 'root') {
        if (!r.data) { needsReload = true; return; }
        applyRootSafeKeys(db, r.data, r.block.changedKeys!);
      }
    });

    // After block sync, handle active streams
    for (const [, stream] of state.activeStreams) {
      if (!stream.resolved) {
        // Try to resolve using isStreaming flag from synced data
        resolveStreamFromDb(stream, db);
      }
      if (stream.resolved && stream.lastText) {
        // Overwrite with latest stream text (more recent than cached block)
        applyStreamText(stream, db);
      }
    }

    if (needsReload) {
      showNotification();
    }
  });
}

/** Stream sync: 다른 기기의 스트리밍 텍스트를 적용한다 */

export function resolveStreamTarget(streamState: StreamState, db: RisuDatabase): boolean {
  if (streamState.resolved) return true;
  if (!streamState.targetCharId) return false;

  const charIndex = db.characters.findIndex(
    (c: RisuCharacter) => c && c.chaId === streamState.targetCharId,
  );
  if (charIndex === -1) return false;

  const char = db.characters[charIndex];
  const chatPage = (char as Record<string, unknown>).chatPage as number ?? 0;
  const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
  const chat = chats?.[chatPage];
  if (!chat || !chat.message) return false;

  streamState.targetCharIndex = charIndex;
  streamState.targetChatIndex = chatPage;

  // Find or create the AI response message
  const messages = chat.message;
  const lastMsg = messages[messages.length - 1];

  if (lastMsg && lastMsg.role === 'char') {
    streamState.targetMsgIndex = messages.length - 1;
  } else {
    // Create placeholder AI message
    messages.push({
      role: 'char',
      data: '',
      saying: streamState.targetCharId,
      time: Date.now(),
    });
    streamState.targetMsgIndex = messages.length - 1;
  }

  chat.isStreaming = true;
  streamState.resolved = true;
  (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
  return true;
}

export function resolveStreamFromDb(streamState: StreamState, db: RisuDatabase): boolean {
  if (streamState.resolved) return true;

  // Search for a character with isStreaming === true
  for (let ci = 0; ci < db.characters.length; ci++) {
    const char = db.characters[ci];
    const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
    if (!chats) continue;
    for (let chatIdx = 0; chatIdx < chats.length; chatIdx++) {
      const chat = chats[chatIdx];
      if (chat?.isStreaming === true && chat.message && chat.message.length > 0) {
        streamState.targetCharId = char.chaId;
        streamState.targetCharIndex = ci;
        streamState.targetChatIndex = chatIdx;
        streamState.targetMsgIndex = chat.message.length - 1;
        streamState.resolved = true;
        return true;
      }
    }
  }

  return false;
}

export function applyStreamText(streamState: StreamState, db: RisuDatabase): void {
  const char = db.characters[streamState.targetCharIndex];
  if (!char) return;
  const chats = (char as Record<string, unknown>).chats as Array<{ message?: Array<Record<string, unknown>>; isStreaming?: boolean }> | undefined;
  const chat = chats?.[streamState.targetChatIndex];
  if (!chat?.message) return;

  if (streamState.targetMsgIndex >= 0 && streamState.targetMsgIndex < chat.message.length) {
    chat.message[streamState.targetMsgIndex].data = streamState.lastText;
  }

  (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
}

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

export function handleStreamEnd(msg: StreamEndMessage): void {
  const streamState = state.activeStreams.get(msg.streamId);

  if (msg.text && msg.targetCharId) {
    applyFinalText(msg.targetCharId, msg.text, streamState);
  } else if (streamState?.resolved) {
    finalizeStream(streamState);
  }

  if (streamState) {
    state.activeStreams.delete(msg.streamId);
  }

  sendAck(msg.streamId);
}

/** isStreaming 해제 + reloadKeys 증가 */
function finalizeStream(streamState: StreamState): void {
  if (!streamState.resolved || typeof __pluginApis__ === 'undefined') return;
  try {
    const db = __pluginApis__.getDatabase();
    const char = db.characters?.[streamState.targetCharIndex];
    if (!char) return;
    const chats = (char as Record<string, unknown>).chats as Array<{ isStreaming?: boolean }> | undefined;
    const chat = chats?.[streamState.targetChatIndex];
    if (chat) {
      chat.isStreaming = false;
    }
    (char as Record<string, unknown>).reloadKeys = ((char as Record<string, unknown>).reloadKeys as number || 0) + 1;
  } catch {
    // Non-fatal
  }
}

/** 최종 텍스트 적용 + isStreaming 해제 */
function applyFinalText(
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

/** 보관소: 미수신 완료 스트림 일괄 처리 */
function processPendingStreams(pendingStreams: ReadonlyArray<PendingStream>): void {
  for (const pending of pendingStreams) {
    if (pending.text && pending.targetCharId) {
      applyFinalText(pending.targetCharId, pending.text, undefined);
    }
    sendAck(pending.id);
  }
}

/** 보관소: 수신 확인 → 서버가 버퍼 삭제 */
function sendAck(streamId: string): void {
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: 'stream-ack', streamId }));
  }
}

/** reconnect 시 서버의 활성 스트림 목록으로 activeStreams 복원 (중복 요청 차단용) */
export function restoreActiveStreams(): void {
  syncFetch('/sync/streams/active')
    .then((r) => r.json() as Promise<{ streams: ReadonlyArray<{ id: string; targetCharId: string | null }> }>)
    .then((data) => {
      if (!data.streams || !data.streams.length) return;
      for (const info of data.streams) {
        if (state.activeStreams.has(info.id)) continue;
        state.activeStreams.set(info.id, {
          streamId: info.id,
          targetCharId: info.targetCharId,
          targetCharIndex: -1,
          targetChatIndex: -1,
          targetMsgIndex: -1,
          resolved: false,
          lastText: '',
        });
      }
    })
    .catch(() => {});
}
