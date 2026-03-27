import { describe, it, expect } from 'vitest';
import { mergeChats } from './mergeChats';
import type { MergeChat, MergeMessage } from '../types';

function chat(id: string | undefined, name: string, messages: MergeMessage[]): MergeChat {
  return { id, name, message: messages };
}

function msg(role: 'user' | 'char', data: string, chatId?: string): MergeMessage {
  return { role, data, chatId };
}

describe('mergeChats', () => {
  it('returns incoming when server is empty', () => {
    const incoming = [chat('c1', 'Chat 1', [msg('user', 'hi')])];
    expect(mergeChats([], incoming)).toEqual(incoming);
  });

  it('returns server when incoming is empty', () => {
    const server = [chat('c1', 'Chat 1', [msg('user', 'hi')])];
    expect(mergeChats(server, [])).toEqual(server);
  });

  it('preserves server-only chats (stale device missing a chat)', () => {
    const server = [
      chat('c1', 'Chat 1', [msg('user', 'hi')]),
      chat('c2', 'Chat 2', [msg('user', 'hello')]),
    ];
    const incoming = [
      chat('c1', 'Chat 1', [msg('user', 'hi')]),
    ];
    const result = mergeChats(server, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('c1');
    expect(result[1].id).toBe('c2');
  });

  it('keeps incoming-only chats (created offline)', () => {
    const server = [
      chat('c1', 'Chat 1', [msg('user', 'hi')]),
    ];
    const incoming = [
      chat('c1', 'Chat 1', [msg('user', 'hi')]),
      chat('c3', 'Offline Chat', [msg('user', 'offline msg')]),
    ];
    const result = mergeChats(server, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('c3');
  });

  it('merges messages within matched chats (by id)', () => {
    const server = [
      chat('c1', 'Chat 1', [
        msg('user', 'hi', 'a'),
        msg('char', 'hello', 'b'),
        msg('user', 'new msg', 'c'),
      ]),
    ];
    const incoming = [
      chat('c1', 'Chat 1', [
        msg('user', 'hi', 'a'),
        msg('char', 'hello', 'b'),
      ]),
    ];
    const result = mergeChats(server, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].message).toHaveLength(3);
    expect(result[0].message[2].chatId).toBe('c');
  });

  it('matches chats by fingerprint when id is missing', () => {
    const server = [
      chat(undefined, 'Chat 1', [
        msg('user', 'hi'),
        msg('char', 'hello'),
        msg('user', 'server-only'),
      ]),
    ];
    const incoming = [
      chat(undefined, 'Chat 1', [
        msg('user', 'hi'),
        msg('char', 'hello'),
      ]),
    ];
    const result = mergeChats(server, incoming);
    expect(result).toHaveLength(1);
    // Messages should be merged: server has 3, incoming has 2
    // server[2] has fingerprint "2:user:server-only" which incoming doesn't have at index 2
    expect(result[0].message.length).toBeGreaterThanOrEqual(3);
  });

  it('preserves incoming chat metadata (name etc) for matched chats', () => {
    const server = [
      chat('c1', 'Old Name', [msg('user', 'hi', 'a')]),
    ];
    const incoming = [
      chat('c1', 'New Name', [msg('user', 'hi', 'a')]),
    ];
    const result = mergeChats(server, incoming);
    expect(result[0].name).toBe('New Name');
  });

  it('preserves server-only chat fields (e.g. note) when incoming is missing them', () => {
    const serverChat: MergeChat = { id: 'c1', name: 'Chat 1', message: [msg('user', 'hi', 'a')], note: 'important' };
    const incomingChat: MergeChat = { id: 'c1', name: 'Chat 1', message: [msg('user', 'hi', 'a')] };
    const result = mergeChats([serverChat], [incomingChat]);
    expect(result[0].note).toBe('important');
  });

  it('incoming chat fields override server when both exist', () => {
    const serverChat: MergeChat = { id: 'c1', name: 'Chat 1', message: [msg('user', 'hi', 'a')], note: 'old note' };
    const incomingChat: MergeChat = { id: 'c1', name: 'Chat 1', message: [msg('user', 'hi', 'a')], note: 'new note' };
    const result = mergeChats([serverChat], [incomingChat]);
    expect(result[0].note).toBe('new note');
  });
});
