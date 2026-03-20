import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/novel-ai';

/**
 * NovelAI SSE 델타.
 * RisuAI에서 비스트리밍으로 사용하나, SSE 지원 시 비-SSE 파서로 추출 가능.
 * openai-response(output 배열)보다 후순위로 시도해야 한다.
 */
export const parse: SSEDeltaParser = parseNonSSE;
