import { isRecord } from './util';

export interface ResponseMeta {
  finishReason: string;
  outputTokens: number;
}

const EMPTY: ResponseMeta = { finishReason: '', outputTokens: 0 };

/**
 * Non-SSE JSON 응답 또는 SSE raw body에서 finish_reason과 output_tokens를 추출한다.
 */
export function extractResponseMeta(body: Buffer, contentType: string): ResponseMeta {
  if (contentType.includes('text/event-stream')) {
    return extractFromSSE(body.toString('utf-8'));
  }

  if (!contentType.includes('application/json')) return EMPTY;

  try {
    const json: unknown = JSON.parse(body.toString('utf-8'));
    if (!isRecord(json)) return EMPTY;
    return extractFromJson(json);
  } catch {
    return EMPTY;
  }
}

function extractFromJson(json: Record<string, unknown>): ResponseMeta {
  let finishReason = '';
  let outputTokens = 0;

  // OpenAI compatible: choices[0].finish_reason, usage.completion_tokens
  if (Array.isArray(json.choices)) {
    for (const choice of json.choices) {
      if (!isRecord(choice)) continue;
      if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
        break;
      }
    }
    if (isRecord(json.usage)) {
      const tokens = Number(json.usage.completion_tokens);
      if (tokens > 0) outputTokens = tokens;
    }
    if (finishReason || outputTokens) return { finishReason, outputTokens };
  }

  // Anthropic: stop_reason, usage.output_tokens
  if (typeof json.stop_reason === 'string') {
    finishReason = json.stop_reason;
    if (isRecord(json.usage)) {
      const tokens = Number(json.usage.output_tokens);
      if (tokens > 0) outputTokens = tokens;
    }
    return { finishReason, outputTokens };
  }

  // Google: candidates[0].finishReason, usageMetadata.candidatesTokenCount
  if (Array.isArray(json.candidates)) {
    for (const candidate of json.candidates) {
      if (!isRecord(candidate)) continue;
      if (typeof candidate.finishReason === 'string') {
        finishReason = candidate.finishReason;
        break;
      }
    }
    if (isRecord(json.usageMetadata)) {
      const tokens = Number(json.usageMetadata.candidatesTokenCount);
      if (tokens > 0) outputTokens = tokens;
    }
    if (finishReason || outputTokens) return { finishReason, outputTokens };
  }

  // OpenAI Response API: status, usage.output_tokens
  if (typeof json.status === 'string' && Array.isArray(json.output)) {
    finishReason = json.status;
    if (isRecord(json.usage)) {
      const tokens = Number(json.usage.output_tokens);
      if (tokens > 0) outputTokens = tokens;
    }
    return { finishReason, outputTokens };
  }

  return EMPTY;
}

/**
 * SSE raw body에서 마지막 이벤트들을 역순으로 스캔하여
 * finish_reason과 usage를 추출한다.
 */
function extractFromSSE(raw: string): ResponseMeta {
  let finishReason = '';
  let outputTokens = 0;

  // 뒤에서부터 스캔 — 메타데이터는 마지막 이벤트들에 있음
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]' || payload === '') continue;

    try {
      const json: unknown = JSON.parse(payload);
      if (!isRecord(json)) continue;

      const result = extractFromJson(json);

      // Anthropic SSE: message_delta 이벤트
      if (json.type === 'message_delta' && isRecord(json.delta)) {
        if (typeof json.delta.stop_reason === 'string') {
          result.finishReason = json.delta.stop_reason;
        }
        if (isRecord(json.usage)) {
          const tokens = Number(json.usage.output_tokens);
          if (tokens > 0) result.outputTokens = tokens;
        }
      }

      if (result.finishReason && !finishReason) finishReason = result.finishReason;
      if (result.outputTokens > 0 && outputTokens === 0) outputTokens = result.outputTokens;

      // 둘 다 찾았으면 종료
      if (finishReason && outputTokens > 0) break;
    } catch {
      continue;
    }
  }

  return { finishReason, outputTokens };
}
