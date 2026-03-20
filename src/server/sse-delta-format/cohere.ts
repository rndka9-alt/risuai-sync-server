import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/cohere';

/**
 * Cohere SSE 델타.
 * RisuAI에서 비스트리밍으로 사용하나, SSE 지원 시 비-SSE 파서로 추출 가능.
 */
export const parse: SSEDeltaParser = parseNonSSE;
