import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * OpenAILegacyInstruct / Ooba (completions) 포맷.
 * { choices: [{ text: "text" }] }
 *
 * openai-compatible보다 후순위로 시도해야 한다:
 * message.content가 없을 때만 choices[].text를 확인.
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.choices)) return null;

  for (const choice of json.choices) {
    if (!isRecord(choice)) continue;
    if (typeof choice.text === 'string') return choice.text;
  }

  return null;
};
