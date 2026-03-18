import type { FormatParser } from './types';

/**
 * NovelList 포맷.
 * { data: ["text"] }
 *
 * data가 문자열 배열일 때만 매칭.
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.data)) return null;
  const first = json.data[0];
  if (typeof first !== 'string') return null;
  return first;
};
