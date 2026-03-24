import { SYNC_PLUGIN_NAME, PROXY_URLS_ARG_KEY } from '../../../shared/syncMarker';

interface PluginLike {
  name: string;
  enabled?: boolean;
  realArg?: Record<string, unknown>;
}

interface DatabaseLike {
  plugins?: PluginLike[];
}

interface PluginApisLike {
  getDatabase(): DatabaseLike;
}

declare var __pluginApis__: PluginApisLike | undefined;

/**
 * 플러그인 DB에서 proxy2 경유 대상 URL prefix 목록을 읽는다.
 * textarea에 한 줄씩 입력된 URL prefix를 파싱하여 빈 줄을 제거한 배열로 반환한다.
 */
export function getProxyUrls(): string[] {
  try {
    if (typeof __pluginApis__ === 'undefined') return [];
    const db = __pluginApis__.getDatabase();
    if (!db?.plugins) return [];

    const plugin = db.plugins.find((p) => p.name === SYNC_PLUGIN_NAME && p.enabled !== false);
    if (!plugin?.realArg) return [];

    const raw = plugin.realArg[PROXY_URLS_ARG_KEY];
    if (typeof raw !== 'string' || raw.trim() === '') return [];

    return raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
