import { describe, it, expect } from 'vitest';
import { looksLikeLlmRequest } from './looksLikeLlmRequest';

describe('looksLikeLlmRequest', () => {
  describe('LLM 요청으로 판별', () => {
    it('OpenAI 형식 (messages 배열)', () => {
      const body = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });

    it('Anthropic 형식 (messages + system)', () => {
      const body = JSON.stringify({
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hello' }],
        system: 'You are helpful.',
        max_tokens: 1024,
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });

    it('Gemini 형식 (contents 배열)', () => {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: 'hello' }] }],
        generation_config: { maxOutputTokens: 1024 },
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });

    it('Cohere 형식 (chat_history 배열)', () => {
      const body = JSON.stringify({
        message: 'hello',
        chat_history: [{ role: 'USER', message: 'hi' }],
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });

    it('NovelAI 형식 (input + parameters)', () => {
      const body = JSON.stringify({
        input: 'Once upon a time',
        model: 'kayra-v1',
        parameters: { max_length: 150, temperature: 0.7 },
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });

    it('Ooba/Kobold 형식 (prompt + temperature)', () => {
      const body = JSON.stringify({
        prompt: 'Once upon a time',
        temperature: 0.7,
        max_tokens: 200,
      });
      expect(looksLikeLlmRequest(body)).toBe(true);
    });
  });

  describe('비-LLM 요청은 제외', () => {
    it('캐릭터 저장 (중첩 model 필드)', () => {
      const body = JSON.stringify({
        name: 'Alice',
        description: 'A character',
        data: { aiModel: 'gpt-4', chats: [] },
      });
      expect(looksLikeLlmRequest(body)).toBe(false);
    });

    it('설정 저장', () => {
      const body = JSON.stringify({
        settings: { model: 'gpt-4', theme: 'dark' },
      });
      expect(looksLikeLlmRequest(body)).toBe(false);
    });

    it('빈 객체', () => {
      expect(looksLikeLlmRequest('{}')).toBe(false);
    });

    it('배열', () => {
      expect(looksLikeLlmRequest('[1,2,3]')).toBe(false);
    });

    it('유효하지 않은 JSON', () => {
      expect(looksLikeLlmRequest('not json')).toBe(false);
    });

    it('빈 문자열', () => {
      expect(looksLikeLlmRequest('')).toBe(false);
    });

    it('prompt만 있고 temperature 없음', () => {
      const body = JSON.stringify({ prompt: 'hello' });
      expect(looksLikeLlmRequest(body)).toBe(false);
    });

    it('input만 있고 parameters 없음', () => {
      const body = JSON.stringify({ input: 'hello' });
      expect(looksLikeLlmRequest(body)).toBe(false);
    });

    it('model만 있는 단순 요청', () => {
      const body = JSON.stringify({ model: 'gpt-4' });
      expect(looksLikeLlmRequest(body)).toBe(false);
    });
  });
});
