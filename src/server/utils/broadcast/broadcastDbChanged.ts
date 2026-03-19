import * as config from '../../config';
import { broadcast } from './broadcast';

export function broadcastDbChanged(excludeClientId: string | null): void {
  broadcast(
    { type: 'db-changed', file: config.DB_PATH, timestamp: Date.now() },
    excludeClientId,
  );
}
