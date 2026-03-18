import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * OpenAICompatible / Mistral 포맷.
 * { choices: [{ message: { content: "text" } }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.choices)) return null;

  for (const choice of json.choices) {
    if (!isRecord(choice)) continue;
    const message = choice.message;
    if (!isRecord(message)) continue;
    if (typeof message.content === 'string') return message.content;
  }

  return null;
};
