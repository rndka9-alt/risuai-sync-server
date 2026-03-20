import type { SSEDeltaParser } from './types';
import { parse as openaiCompatible } from './openai-compatible';
import { parse as anthropic } from './anthropic';
import { parse as google } from './google';
import { parse as openaiResponse } from './openai-response';
import { parse as cohere } from './cohere';
import { parse as openaiLegacy } from './openai-legacy';
import { parse as kobold } from './kobold';
import { parse as horde } from './horde';
import { parse as novelAi } from './novel-ai';
import { parse as novelList } from './novel-list';

/**
 * SSE 델타 파서 우선순위.
 * llm-response-format과 동일한 어댑터 패턴.
 *
 * - openaiCompatible(delta.content)을 openaiLegacy(choices[].text)보다 먼저
 * - openaiResponse(response.output_text.delta)를 novelAi(output string)보다 먼저
 * - novelList(data[])은 다른 포맷과 겹칠 수 있어 후순위
 */
export const parsers: SSEDeltaParser[] = [
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
 * SSE data payload JSON에서 텍스트 델타를 추출한다.
 * 모든 등록된 파서를 순회하며 첫 번째 매칭 결과를 반환한다.
 * 매칭 실패 시 null.
 */
export function extractDelta(json: Record<string, unknown>): string | null {
  for (const parser of parsers) {
    const result = parser(json);
    if (result !== null) return result;
  }
  return null;
}
