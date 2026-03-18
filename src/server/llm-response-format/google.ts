import type { FormatParser } from './types';
import { isRecord } from './util';

/**
 * GoogleCloud / VertexAIGemini 포맷.
 * { candidates: [{ content: { parts: [{ text: "text" }] } }] }
 */
export const parse: FormatParser = (json) => {
  if (!Array.isArray(json.candidates)) return null;

  for (const candidate of json.candidates) {
    if (!isRecord(candidate)) continue;
    const content = candidate.content;
    if (!isRecord(content)) continue;
    if (!Array.isArray(content.parts)) continue;

    const parts: string[] = [];
    for (const part of content.parts) {
      if (!isRecord(part)) continue;
      // thought: true인 파트는 추론 과정이므로 제외
      if (part.thought === true) continue;
      if (typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    if (parts.length > 0) return parts.join('');
  }

  return null;
};
