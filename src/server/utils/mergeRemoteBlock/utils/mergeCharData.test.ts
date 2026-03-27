import { describe, it, expect } from 'vitest';
import { mergeCharData } from './mergeCharData';
import type { MergeCharData, MergeChat, MergeMessage } from '../types';

function msg(role: 'user' | 'char', data: string, chatId?: string): MergeMessage {
  return { role, data, chatId };
}

function chat(id: string, messages: MergeMessage[]): MergeChat {
  return { id, name: 'test', message: messages };
}

function charData(chats: MergeChat[], extra?: Record<string, unknown>): MergeCharData {
  return { chats, chatPage: 0, ...extra };
}

describe('mergeCharData', () => {
  it('preserves incoming metadata while merging chats', () => {
    const server = charData([chat('c1', [msg('user', 'hi', 'a')])], { desc: 'old desc' });
    const incoming = charData([chat('c1', [msg('user', 'hi', 'a')])], { desc: 'new desc' });

    const result = mergeCharData(server, incoming);
    expect(result.desc).toBe('new desc');
    expect(result.chats).toHaveLength(1);
  });

  it('merges chats correctly', () => {
    const server = charData([
      chat('c1', [msg('user', 'hi', 'a'), msg('char', 'hello', 'b')]),
      chat('c2', [msg('user', 'server-only chat')]),
    ]);
    const incoming = charData([
      chat('c1', [msg('user', 'hi', 'a')]),
    ]);

    const result = mergeCharData(server, incoming);
    expect(result.chats).toHaveLength(2);
    expect(result.chats[0].message).toHaveLength(2);
  });

  it('clamps chatPage to valid range', () => {
    const server = charData([chat('c1', [msg('user', 'hi')])]);
    const incoming = charData([chat('c1', [msg('user', 'hi')])]);
    incoming.chatPage = 99;

    const result = mergeCharData(server, incoming);
    expect(result.chatPage).toBe(0);
  });

  it('preserves server-only fields when incoming is missing them', () => {
    const server = charData([chat('c1', [msg('user', 'hi', 'a')])], { desc: 'server desc', license: 'MIT' });
    const incoming = charData([chat('c1', [msg('user', 'hi', 'a')])]);

    const result = mergeCharData(server, incoming);
    expect(result.desc).toBe('server desc');
    expect(result.license).toBe('MIT');
  });

  it('incoming overrides server fields when both exist', () => {
    const server = charData([chat('c1', [msg('user', 'hi', 'a')])], { desc: 'old', license: 'MIT' });
    const incoming = charData([chat('c1', [msg('user', 'hi', 'a')])], { desc: 'new' });

    const result = mergeCharData(server, incoming);
    expect(result.desc).toBe('new');
    expect(result.license).toBe('MIT');
  });

  it('preserves chatPage when valid', () => {
    const server = charData([
      chat('c1', [msg('user', 'hi')]),
      chat('c2', [msg('user', 'hello')]),
    ]);
    const incoming = charData([
      chat('c1', [msg('user', 'hi')]),
      chat('c2', [msg('user', 'hello')]),
    ]);
    incoming.chatPage = 1;

    const result = mergeCharData(server, incoming);
    expect(result.chatPage).toBe(1);
  });
});
