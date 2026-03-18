import { describe, it, expect } from 'vitest';
import { extractResponseText } from './index';

function buf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj));
}

const JSON_CT = 'application/json';
const JSON_CT_UTF8 = 'application/json; charset=utf-8';

// ─── Adapter: extractResponseText ─────────────────────────────────

describe('extractResponseText', () => {
  it('returns empty for non-200 status', () => {
    expect(extractResponseText(429, JSON_CT, buf({ choices: [{ message: { content: 'x' } }] }))).toBe('');
  });

  it('returns empty for non-JSON content-type', () => {
    expect(extractResponseText(200, 'text/html', Buffer.from('Hello'))).toBe('');
  });

  it('returns empty for undefined content-type', () => {
    expect(extractResponseText(200, undefined, Buffer.from('{}'))).toBe('');
  });

  it('returns empty for malformed JSON', () => {
    expect(extractResponseText(200, JSON_CT, Buffer.from('not json{{'))).toBe('');
  });

  it('returns empty for unrecognized JSON structure', () => {
    expect(extractResponseText(200, JSON_CT, buf({ id: '123' }))).toBe('');
  });

  it('handles content-type with charset', () => {
    expect(extractResponseText(200, JSON_CT_UTF8, buf({
      choices: [{ message: { content: 'ok' } }],
    }))).toBe('ok');
  });
});

// ─── OpenAI Compatible ────────────────────────────────────────────

describe('OpenAI Compatible', () => {
  it('extracts choices[].message.content', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      choices: [{ message: { content: 'Hello world' } }],
    }))).toBe('Hello world');
  });

  it('returns empty when content is null', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      choices: [{ message: { content: null } }],
    }))).toBe('');
  });
});

// ─── OpenAI Legacy / Ooba ─────────────────────────────────────────

describe('OpenAI Legacy / Ooba', () => {
  it('extracts choices[].text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      choices: [{ text: 'Completion text' }],
    }))).toBe('Completion text');
  });
});

// ─── Anthropic ────────────────────────────────────────────────────

describe('Anthropic', () => {
  it('extracts content[].type=text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      content: [{ type: 'text', text: 'Bonjour' }],
    }))).toBe('Bonjour');
  });

  it('concatenates multiple text blocks', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' World' },
      ],
    }))).toBe('Hello World');
  });

  it('skips non-text blocks', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      content: [{ type: 'image', source: {} }],
    }))).toBe('');
  });
});

// ─── Google / Gemini ──────────────────────────────────────────────

describe('Google / Gemini', () => {
  it('extracts candidates[].content.parts[].text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      candidates: [{ content: { parts: [{ text: 'Gemini says' }] } }],
    }))).toBe('Gemini says');
  });

  it('concatenates multiple parts', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      candidates: [{ content: { parts: [
        { text: 'Part 1' },
        { text: ' Part 2' },
      ] } }],
    }))).toBe('Part 1 Part 2');
  });

  it('skips thought parts', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      candidates: [{ content: { parts: [
        { thought: true, text: 'thinking...' },
        { text: 'answer' },
      ] } }],
    }))).toBe('answer');
  });
});

// ─── OpenAI Response API ──────────────────────────────────────────

describe('OpenAI Response API', () => {
  it('extracts output[].content[].type=output_text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Response API text' }],
      }],
    }))).toBe('Response API text');
  });

  it('skips non-message output items', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      output: [{ type: 'tool_call', id: '123' }],
    }))).toBe('');
  });
});

// ─── Cohere ───────────────────────────────────────────────────────

describe('Cohere', () => {
  it('extracts text with generation_id', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      text: 'Cohere response',
      generation_id: 'gen-123',
    }))).toBe('Cohere response');
  });

  it('extracts text with response_id', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      text: 'Cohere v2',
      response_id: 'resp-456',
    }))).toBe('Cohere v2');
  });

  it('does not match bare text field without Cohere identifiers', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      text: 'ambiguous',
    }))).toBe('');
  });
});

// ─── Kobold / OobaLegacy ──────────────────────────────────────────

describe('Kobold / OobaLegacy', () => {
  it('extracts results[].text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      results: [{ text: 'Kobold output' }],
    }))).toBe('Kobold output');
  });
});

// ─── Horde ────────────────────────────────────────────────────────

describe('Horde', () => {
  it('extracts generations[].text', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      generations: [{ text: 'Horde output' }],
    }))).toBe('Horde output');
  });
});

// ─── NovelAI ──────────────────────────────────────────────────────

describe('NovelAI', () => {
  it('extracts output string', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      output: 'NovelAI text',
    }))).toBe('NovelAI text');
  });
});

// ─── NovelList ────────────────────────────────────────────────────

describe('NovelList', () => {
  it('extracts data[0] string', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      data: ['NovelList text'],
    }))).toBe('NovelList text');
  });

  it('returns empty for non-string data array', () => {
    expect(extractResponseText(200, JSON_CT, buf({
      data: [123],
    }))).toBe('');
  });
});
