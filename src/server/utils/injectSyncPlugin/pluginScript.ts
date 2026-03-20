/**
 * V3 플러그인 스크립트를 문자열로 생성한다.
 * bodyIntercepter를 등록하여 LLM 요청 body에 sync 마커를 삽입한다.
 */
export function buildPluginScript(markerKey: string): string {
  return [
    '//@name [Proxy::sync] capture-streaming',
    '//@display-name [Proxy::sync] capture-streaming',
    '//@api 3.0',
    '',
    '(async () => {',
    `    const MARKER_KEY = ${JSON.stringify(markerKey)};`,
    '    const STREAMING_TYPES = new Set([',
    "        'anthropic_streaming', 'anthropic_streaming_retry',",
    "        'openai_streaming',",
    "        'gemini_base_stream',",
    '    ]);',
    '',
    '    await risuai.registerBodyIntercepter(async (body, type) => {',
    '        try {',
    "            const parsed = typeof body === 'string' ? JSON.parse(body) : body;",
    "            if (typeof parsed !== 'object' || parsed === null) return body;",
    '',
    '            parsed[MARKER_KEY] = {',
    '                interceptorType: type,',
    '                streaming: STREAMING_TYPES.has(type),',
    '            };',
    '',
    "            return typeof body === 'string' ? JSON.stringify(parsed) : parsed;",
    '        } catch {',
    '            return body;',
    '        }',
    '    });',
    '})();',
  ].join('\n');
}
