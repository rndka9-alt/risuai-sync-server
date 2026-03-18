import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * Anthropic / AWSBedrockClaude 포맷.
 * { content: [{ type: "text", text: "text" }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.content)) return null;

  const parts: string[] = [];
  for (const block of json.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }

  return parts.length > 0 ? parts.join('') : null;
};
