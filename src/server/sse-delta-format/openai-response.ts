import type { SSEDeltaParser } from './types';

/**
 * OpenAI Response API SSE 델타.
 * data: { type: "response.output_text.delta", delta: "text" }
 *
 * 비-SSE(output[].content[].text)와 달리 이벤트 기반으로 delta 문자열을 직접 추출한다.
 */
export const parse: SSEDeltaParser = (json) => {
  if (json.type !== 'response.output_text.delta') return null;
  if (typeof json.delta !== 'string') return null;
  return json.delta;
};
