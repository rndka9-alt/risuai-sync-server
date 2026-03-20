import type { SSEDeltaParser } from './types';
import { isRecord } from '../llm-response-format/util';

/**
 * Anthropic SSE 델타.
 * data: { type: "content_block_delta", delta: { type: "text_delta", text: "text" } }
 *
 * 비-SSE(content[].text)와 달리 content_block_delta 이벤트에서 delta.text를 추출한다.
 */
export const parse: SSEDeltaParser = (json) => {
  if (json.type !== 'content_block_delta') return null;
  const delta = json.delta;
  if (!isRecord(delta)) return null;
  if (typeof delta.text === 'string') return delta.text;
  return null;
};
