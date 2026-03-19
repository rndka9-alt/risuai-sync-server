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
export const PLUGIN_WRITABLE_KEYS: ReadonlySet<string> = new Set([
  'characters', 'modules', 'enabledModules', 'moduleIntergration',
  'pluginV2', 'personas', 'plugins', 'pluginCustomStorage',
  'temperature', 'askRemoval', 'maxContext', 'maxResponse',
  'frequencyPenalty', 'PresensePenalty', 'theme', 'textTheme',
  'lineHeight', 'seperateModelsForAxModels', 'seperateModels',
  'customCSS', 'guiHTML', 'colorSchemeName', 'selectedPersona',
  'characterOrder',
]);

/** RisuAI 플러그인 API 타입 */
export interface RisuCharacter {
  chaId: string;
  [key: string]: unknown;
}

export interface RisuDatabase {
  characters: RisuCharacter[];
  [key: string]: unknown;
}

export interface PluginApis {
  getDatabase(): RisuDatabase;
}

/** fetch 결과 타입 */
export type CharFetchResult = { type: 'char'; name: string; block: import('../../shared/types').BlockChange; data: RisuCharacter | null };
export type RootFetchResult = { type: 'root'; name: string; block: import('../../shared/types').BlockChange; data: Record<string, unknown> | null };
