import { SYNC_MARKER_KEY, SYNC_PLUGIN_NAME } from '../../../shared/syncMarker';
import { buildPluginScript } from './pluginScript';

interface PluginEntry {
  name: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * ROOT JSON의 plugins 배열에 sync 마커 플러그인을 주입한다.
 * 이미 동일 이름의 플러그인이 존재하면 (비활성화 포함) 건드리지 않는다.
 *
 * @returns 수정된 JSON 문자열. 변경 없으면 원본 그대로 반환.
 */
export function injectSyncPlugin(rootJson: string): string {
  const root: Record<string, unknown> = JSON.parse(rootJson);

  if (!Array.isArray(root.plugins)) {
    root.plugins = [];
  }

  const plugins = root.plugins as PluginEntry[];
  const existing = plugins.find((p) => p.name === SYNC_PLUGIN_NAME);
  if (existing) {
    return rootJson;
  }

  plugins.push({
    name: SYNC_PLUGIN_NAME,
    displayName: SYNC_PLUGIN_NAME,
    script: buildPluginScript(SYNC_MARKER_KEY),
    version: '3.0',
    enabled: true,
    arguments: {},
    realArg: {},
    customLink: [],
    argMeta: {},
    versionOfPlugin: '',
    updateURL: '',
  });

  return JSON.stringify(root);
}
