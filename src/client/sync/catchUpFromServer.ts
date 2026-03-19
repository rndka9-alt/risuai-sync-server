import type { BlockChange, ChangesResponse, ChangeLogEntry } from '../../shared/types';
import { CLIENT_ID, syncFetch } from '../config';
import { state } from '../state';
import { reloadOnEpochMismatch } from '../epochReload';
import { sendCaughtUp } from './sendCaughtUp';
import { handleBlocksChanged } from './handleBlocksChanged';
import { processPendingStreams } from './processPendingStreams';

/** Catch-up: 놓친 변경분 복구 */
export function catchUpFromServer(): void {
  syncFetch('/sync/changes?since=' + state.lastVersion + '&clientId=' + encodeURIComponent(CLIENT_ID))
    .then((r) => {
      if (r.status === 410) {
        reloadOnEpochMismatch('catch-up-410', state.epoch, 0);
        return null;
      }
      return r.json() as Promise<ChangesResponse>;
    })
    .then((data) => {
      if (!data) return;
      if (state.epoch && state.epoch !== data.epoch) {
        reloadOnEpochMismatch('catch-up-epoch', state.epoch, data.epoch);
        return;
      }
      state.epoch = data.epoch;
      if (!data.changes || !data.changes.length) {
        state.lastVersion = data.version;
        sendCaughtUp();
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

      sendCaughtUp();
    })
    .catch(() => {});
}
