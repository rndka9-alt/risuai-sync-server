import type { FormatParser } from './types';
import { parse as openaiCompatible } from './openai-compatible';
import { parse as openaiLegacy } from './openai-legacy';
import { parse as anthropic } from './anthropic';
import { parse as google } from './google';
import { parse as openaiResponse } from './openai-response';
import { parse as cohere } from './cohere';
import { parse as novelAi } from './novel-ai';
import { parse as kobold } from './kobold';
import { parse as horde } from './horde';
import { parse as novelList } from './novel-list';

/**
 * 파서 우선순위.
 * 구조가 고유한 포맷을 먼저, 겹칠 수 있는 포맷을 나중에 시도한다.
 *
 * - openaiCompatible(choices[].message.content)을 openaiLegacy(choices[].text)보다 먼저
 * - openaiResponse(output[])을 novelAi(output string)보다 먼저
 * - novelList(data[])은 다른 포맷과 겹칠 수 있어 후순위
 */
const parsers: FormatParser[] = [
  openaiCompatible,
  anthropic,
  google,
  openaiResponse,
  cohere,
  openaiLegacy,
  kobold,
  horde,
  novelAi,
  novelList,
];

/**
 * Non-SSE 응답 body에서 생성 텍스트를 추출한다.
 * 모든 등록된 포맷 파서를 순회하며 첫 번째 매칭 결과를 반환한다.
 * 파싱 실패 시 빈 문자열 (graceful degradation).
 */
export function extractResponseText(
  status: number,
  contentType: string | undefined,
  body: Buffer,
): string {
  if (status !== 200) return '';
  if (!contentType || !contentType.includes('application/json')) return '';

  try {
    const json: Record<string, unknown> = JSON.parse(body.toString('utf-8'));

    for (const parser of parsers) {
      const result = parser(json);
      if (result !== null) return result;
    }

    return '';
  } catch {
    return '';
  }
}
