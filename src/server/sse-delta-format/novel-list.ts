import type { SSEDeltaParser } from './types';
import { parse as parseNonSSE } from '../llm-response-format/novel-list';

/**
 * NovelList SSE 델타.
 * RisuAI에서 비스트리밍으로 사용하나, SSE 지원 시 비-SSE 파서로 추출 가능.
 * data[]가 다른 포맷과 겹칠 수 있어 후순위.
 */
export const parse: SSEDeltaParser = parseNonSSE;
