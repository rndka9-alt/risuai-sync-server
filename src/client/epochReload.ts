import { serverLog } from './serverLog';

/** Epoch 불일치 시 서버에 로그 후 즉시 reload */
export function reloadOnEpochMismatch(
  trigger: string,
  clientEpoch: number,
  serverEpoch: number,
): void {
  serverLog('warn', 'Epoch mismatch, force reloading', {
    trigger,
    clientEpoch: String(clientEpoch),
    serverEpoch: String(serverEpoch),
  });
  location.reload();
}
