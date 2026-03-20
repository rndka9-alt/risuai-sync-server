import type { SSEDeltaParser } from './types';
import { isRecord } from '../llm-response-format/util';

/**
 * OpenAI Compatible SSE 델타.
 * data: { choices: [{ delta: { content: "text" } }] }
 *
 * 비-SSE(message.content)와 달리 delta.content를 추출한다.
 */
export const parse: SSEDeltaParser = (json) => {
  if (!Array.isArray(json.choices)) return null;

  for (const choice of json.choices) {
    if (!isRecord(choice)) continue;
    const delta = choice.delta;
    if (!isRecord(delta)) continue;
    if (typeof delta.content === 'string') return delta.content;
  }

  return null;
};
