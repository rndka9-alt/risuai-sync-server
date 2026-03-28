/**
 * V3 플러그인 스크립트를 문자열로 생성한다.
 * bodyIntercepter를 등록하여 LLM 요청 body에 sync 마커를 삽입한다.
 *
 * V3 플러그인은 Promise.all로 병렬 로딩되므로 intercepter 등록 순서가
 * 비결정적이다. 다른 intercepter가 body를 재구성하면 마커가 유실되므로,
 * 초기 등록 후 지연 재등록으로 배열 끝(=마지막 실행)을 확보한다.
 */
export function buildPluginScript(markerKey: string): string {
  return [
    '//@name [Proxy::sync] Send via proxy2',
    '//@display-name [Proxy::sync] Send via proxy2',
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
    '    const addMarker = async (body, type) => {',
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
    '    };',
    '',
    '    let reg = await risuai.registerBodyIntercepter(addMarker);',
    '',
    '    setTimeout(async () => {',
    '        if (!reg) return;',
    '        const newReg = await risuai.registerBodyIntercepter(addMarker);',
    '        if (newReg) {',
    '            risuai.unregisterBodyIntercepter(reg.id);',
    '            reg = newReg;',
    '        }',
    `    }, ${REREGISTER_DELAY_MS});`,
    '})();',
  ].join('\n');
}

/**
 * 다른 플러그인의 intercepter 등록이 완료될 때까지 기다리는 시간.
 * V3 플러그인 병렬 로딩 + iframe 초기화 + 권한 확인을 고려한 값.
 */
export const REREGISTER_DELAY_MS = 1500;
