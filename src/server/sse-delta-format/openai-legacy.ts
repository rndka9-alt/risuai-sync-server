import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/openai-legacy';

/**
 * OpenAI Legacy / Ooba SSE 델타.
 * data: { choices: [{ text: "text" }] }
 *
 * completions API의 SSE 청크는 비-SSE 응답과 같은 choices[].text 구조를 사용한다.
 * openai-compatible(delta.content)보다 후순위로 시도해야 한다.
 */
export const parse: SSEDeltaParser = parseNonSSE;
