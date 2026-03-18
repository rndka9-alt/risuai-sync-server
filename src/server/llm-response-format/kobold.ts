import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * Kobold / OobaLegacy 포맷.
 * { results: [{ text: "text" }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.results)) return null;

  for (const result of json.results) {
    if (!isRecord(result)) continue;
    if (typeof result.text === 'string') return result.text;
  }

  return null;
};
