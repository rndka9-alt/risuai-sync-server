import { describe, it, expect } from 'vitest';
import { extractDelta } from './index';

// ─── OpenAI Compatible SSE ────────────────────────────────────────

describe('OpenAI Compatible SSE', () => {
  it('extracts choices[].delta.content', () => {
    expect(extractDelta({
      choices: [{ delta: { content: 'Hello' }, index: 0 }],
    })).toBe('Hello');
  });

  it('returns null when delta has no content', () => {
    expect(extractDelta({
      choices: [{ delta: { role: 'assistant' }, index: 0 }],
    })).toBeNull();
  });

  it('returns null for empty string content (valid delta)', () => {
    expect(extractDelta({
      choices: [{ delta: { content: '' }, index: 0 }],
    })).toBe('');
  });

  it('skips non-object choices', () => {
    expect(extractDelta({ choices: ['invalid'] })).toBeNull();
  });
});

// ─── Anthropic SSE ────────────────────────────────────────────────

describe('Anthropic SSE', () => {
  it('extracts content_block_delta text', () => {
    expect(extractDelta({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Bonjour' },
    })).toBe('Bonjour');
  });

  it('ignores non-text delta types (thinking)', () => {
    expect(extractDelta({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    })).toBeNull();
  });

  it('ignores message_start events', () => {
    expect(extractDelta({
      type: 'message_start',
      message: { id: 'msg_123' },
    })).toBeNull();
  });

  it('ignores content_block_start events', () => {
    expect(extractDelta({
      type: 'content_block_start',
      content_block: { type: 'text', text: '' },
    })).toBeNull();
  });
});

// ─── Google Gemini SSE ────────────────────────────────────────────

describe('Google Gemini SSE', () => {
  it('extracts candidates[].content.parts[].text', () => {
    expect(extractDelta({
      candidates: [{ content: { parts: [{ text: 'Gemini says' }] } }],
    })).toBe('Gemini says');
  });

  it('concatenates multiple text parts', () => {
    expect(extractDelta({
      candidates: [{ content: { parts: [
        { text: 'Part 1' },
        { text: ' Part 2' },
      ] } }],
    })).toBe('Part 1 Part 2');
  });

  it('skips thought parts', () => {
    expect(extractDelta({
      candidates: [{ content: { parts: [
        { thought: true, text: 'thinking...' },
        { text: 'answer' },
      ] } }],
    })).toBe('answer');
  });

  it('returns null for empty candidates', () => {
    expect(extractDelta({ candidates: [] })).toBeNull();
  });
});

// ─── OpenAI Response API SSE ──────────────────────────────────────

describe('OpenAI Response API SSE', () => {
  it('extracts response.output_text.delta', () => {
    expect(extractDelta({
      type: 'response.output_text.delta',
      delta: 'Response API text',
      output_index: 0,
      content_index: 0,
    })).toBe('Response API text');
  });

  it('ignores other response event types', () => {
    expect(extractDelta({
      type: 'response.created',
      response: { id: 'resp_123' },
    })).toBeNull();
  });

  it('returns null when delta is not a string', () => {
    expect(extractDelta({
      type: 'response.output_text.delta',
      delta: { text: 'nested' },
    })).toBeNull();
  });
});

// ─── Cohere SSE ───────────────────────────────────────────────────

describe('Cohere SSE', () => {
  it('extracts text with generation_id', () => {
    expect(extractDelta({
      text: 'Cohere chunk',
      generation_id: 'gen-123',
    })).toBe('Cohere chunk');
  });

  it('does not match bare text field', () => {
    expect(extractDelta({ text: 'ambiguous' })).toBeNull();
  });
});

// ─── OpenAI Legacy SSE ────────────────────────────────────────────

describe('OpenAI Legacy SSE', () => {
  it('extracts choices[].text', () => {
    expect(extractDelta({
      choices: [{ text: 'completion chunk' }],
    })).toBe('completion chunk');
  });
});

// ─── Kobold SSE ───────────────────────────────────────────────────

describe('Kobold SSE', () => {
  it('extracts results[].text', () => {
    expect(extractDelta({
      results: [{ text: 'Kobold output' }],
    })).toBe('Kobold output');
  });
});

// ─── Horde SSE ────────────────────────────────────────────────────

describe('Horde SSE', () => {
  it('extracts generations[].text', () => {
    expect(extractDelta({
      generations: [{ text: 'Horde output' }],
    })).toBe('Horde output');
  });
});

// ─── NovelAI SSE ──────────────────────────────────────────────────

describe('NovelAI SSE', () => {
  it('extracts output string', () => {
    expect(extractDelta({ output: 'NovelAI text' })).toBe('NovelAI text');
  });
});

// ─── NovelList SSE ────────────────────────────────────────────────

describe('NovelList SSE', () => {
  it('extracts data[0] string', () => {
    expect(extractDelta({ data: ['NovelList text'] })).toBe('NovelList text');
  });
});

// ─── Priority / Edge Cases ────────────────────────────────────────

describe('Priority', () => {
  it('prefers OpenAI delta.content over legacy choices[].text', () => {
    expect(extractDelta({
      choices: [{ delta: { content: 'modern' }, text: 'legacy' }],
    })).toBe('modern');
  });

  it('returns null for unrecognized format', () => {
    expect(extractDelta({ id: 'unknown', object: 'something' })).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(extractDelta({})).toBeNull();
  });
});
