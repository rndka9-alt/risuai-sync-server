import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * AI Horde 포맷.
 * { generations: [{ text: "text" }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.generations)) return null;

  for (const gen of json.generations) {
    if (!isRecord(gen)) continue;
    if (typeof gen.text === 'string') return gen.text;
  }

  return null;
};
