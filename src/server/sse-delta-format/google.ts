import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/google';

/**
 * Google Gemini SSE 델타.
 * data: { candidates: [{ content: { parts: [{ text: "text" }] } }] }
 *
 * SSE 청크와 비-SSE 응답의 JSON 구조가 동일하므로 비-SSE 파서를 그대로 사용한다.
 */
export const parse: SSEDeltaParser = parseNonSSE;
