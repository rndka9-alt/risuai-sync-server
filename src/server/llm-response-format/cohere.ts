import type { FormatParser } from './types';

/**
 * Cohere 포맷.
 * { text: "text" }
 *
 * 다른 포맷과 겹치지 않도록, Cohere 고유 필드(generation_id 등)를 함께 확인.
 */
export const parse: FormatParser = (json) => {
  if (typeof json.text !== 'string') return null;
  // Cohere 응답에는 generation_id 또는 response_id가 포함됨
  if (typeof json.generation_id !== 'string' && typeof json.response_id !== 'string') return null;
  return json.text;
};
