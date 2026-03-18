import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * OpenAI Response API 포맷.
 * { output: [{ type: "message", content: [{ type: "output_text", text: "text" }] }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.output)) return null;

  for (const item of json.output) {
    if (!isRecord(item)) continue;
    if (item.type !== 'message') continue;
    if (!Array.isArray(item.content)) continue;

    for (const block of item.content) {
      if (!isRecord(block)) continue;
      if (block.type === 'output_text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }

  return null;
};
