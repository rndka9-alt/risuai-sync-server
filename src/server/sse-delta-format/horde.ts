import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/horde';

/**
 * AI Horde SSE 델타.
 * RisuAI에서 폴링 기반으로 사용하나, SSE 지원 시 비-SSE 파서로 추출 가능.
 */
export const parse: SSEDeltaParser = parseNonSSE;
