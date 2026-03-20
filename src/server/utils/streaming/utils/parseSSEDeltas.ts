import { extractDelta } from '../../../sse-delta-format/index';

/**
 * SSE 텍스트에서 텍스트 델타를 추출한다.
 * sse-delta-format 어댑터 패턴으로 모든 LLM 포맷을 지원한다.
 */
export function parseSSEDeltas(raw: string): string[] {
  const deltas: string[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6).trim();
    if (payload === '[DONE]' || payload === '') continue;

    try {
      const json: Record<string, unknown> = JSON.parse(payload);
      const delta = extractDelta(json);
      if (delta !== null) {
        deltas.push(delta);
      }
    } catch {
      // JSON parse failure — skip
    }
  }

  return deltas;
}
