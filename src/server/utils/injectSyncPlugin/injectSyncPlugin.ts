import { SYNC_MARKER_KEY, SYNC_PLUGIN_NAME, SYNC_PLUGIN_NAME_LEGACY, PROXY_URLS_ARG_KEY } from '../../../shared/syncMarker';
import { buildPluginScript } from './pluginScript';

interface PluginEntry {
  name: string;
  displayName?: string;
  enabled?: boolean;
  script?: string;
  arguments?: Record<string, unknown>;
  argMeta?: Record<string, unknown>;
  realArg?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * ROOT JSON의 plugins 배열에 sync 마커 플러그인을 주입한다.
 * 이미 동일 이름의 플러그인이 존재하면 (비활성화 포함) 건드리지 않는다.
 * 이전 이름의 플러그인이 있으면 새 이름으로 마이그레이션한다.
 *
 * @returns 수정된 JSON 문자열. 변경 없으면 원본 그대로 반환.
 */
export function injectSyncPlugin(rootJson: string): string {
  const root: Record<string, unknown> = JSON.parse(rootJson);

  if (!Array.isArray(root.plugins)) {
    root.plugins = [];
  }

  const plugins = root.plugins as PluginEntry[];

  // 새 이름으로 이미 존재하면 건드리지 않음
  const existing = plugins.find((p) => p.name === SYNC_PLUGIN_NAME);
  if (existing) {
    return rootJson;
  }

  // 이전 이름 → 새 이름으로 마이그레이션
  const legacy = plugins.find((p) => p.name === SYNC_PLUGIN_NAME_LEGACY);
  if (legacy) {
    legacy.name = SYNC_PLUGIN_NAME;
    legacy.displayName = SYNC_PLUGIN_NAME;
    legacy.script = buildPluginScript(SYNC_MARKER_KEY);
    if (!legacy.arguments || typeof legacy.arguments !== 'object') {
      legacy.arguments = {};
    }
    legacy.arguments[PROXY_URLS_ARG_KEY] = 'string';
    if (!legacy.argMeta || typeof legacy.argMeta !== 'object') {
      legacy.argMeta = {};
    }
    legacy.argMeta[PROXY_URLS_ARG_KEY] = {
      textarea: true,
      name: 'Proxy URLs',
      description: 'proxy2를 경유할 URL prefix (한 줄에 하나)',
    };
    if (!legacy.realArg || typeof legacy.realArg !== 'object') {
      legacy.realArg = {};
    }
    if (!(PROXY_URLS_ARG_KEY in legacy.realArg)) {
      legacy.realArg[PROXY_URLS_ARG_KEY] = '';
    }
    return JSON.stringify(root);
  }

  // 신규 주입
  plugins.push({
    name: SYNC_PLUGIN_NAME,
    displayName: SYNC_PLUGIN_NAME,
    script: buildPluginScript(SYNC_MARKER_KEY),
    version: '3.0',
    enabled: true,
    arguments: { [PROXY_URLS_ARG_KEY]: 'string' },
    realArg: { [PROXY_URLS_ARG_KEY]: '' },
    customLink: [],
    argMeta: {
      [PROXY_URLS_ARG_KEY]: {
        textarea: true,
        name: 'Proxy URLs',
        description: 'proxy2를 경유할 URL prefix (한 줄에 하나)',
      },
    },
    versionOfPlugin: '',
    updateURL: '',
  });

  return JSON.stringify(root);
}
