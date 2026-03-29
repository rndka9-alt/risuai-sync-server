/**
 * proxy2 요청 body가 LLM 요청처럼 보이는지 판별한다.
 * sync marker가 없는 프로바이더 플러그인 요청을 잡기 위한 heuristic.
 *
 * 단순 문자열 매칭('"model"')은 캐릭터 저장 등 비-LLM 요청에도
 * 걸리므로, JSON 파싱 후 최상위 필드 조합으로 판별한다.
 */
export function looksLikeLlmRequest(bodyStr: string): boolean {
  try {
    const parsed = JSON.parse(bodyStr);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    // OpenAI, Anthropic, 대부분의 OpenAI-compatible 프로바이더
    if (Array.isArray(parsed.messages)) return true;

    // Google Gemini
    if (Array.isArray(parsed.contents)) return true;

    // Cohere
    if (Array.isArray(parsed.chat_history)) return true;

    // NovelAI (input + parameters 조합)
    if (typeof parsed.input === 'string' && typeof parsed.parameters === 'object') return true;

    // Completion 형식 (Ooba, Kobold 등) — prompt 단독은 너무 넓으므로 sampling 파라미터와 조합
    if (typeof parsed.prompt === 'string' && typeof parsed.temperature === 'number') return true;

    return false;
  } catch {
    return false;
  }
}
