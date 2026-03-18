import type { FormatParser } from './types';

/**
 * NovelAI 포맷.
 * { output: "text" }
 *
 * output이 문자열일 때만 매칭 (OpenAI Response API의 output은 배열).
 */
export const parse: FormatParser = (json) => {
  if (typeof json.output !== 'string') return null;
  return json.output;
};
