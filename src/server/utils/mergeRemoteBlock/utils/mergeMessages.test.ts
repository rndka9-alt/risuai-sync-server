import { describe, it, expect } from 'vitest';
import { mergeMessages } from './mergeMessages';
import type { MergeMessage } from '../types';

function msg(role: 'user' | 'char', data: string, extra?: Partial<MergeMessage>): MergeMessage {
  return { role, data, ...extra };
}

describe('mergeMessages', () => {
  it('returns incoming when server is empty', () => {
    const incoming = [msg('user', 'hello')];
    expect(mergeMessages([], incoming)).toEqual(incoming);
  });

  it('returns server when incoming is empty', () => {
    const server = [msg('user', 'hello')];
    expect(mergeMessages(server, [])).toEqual(server);
  });

  it('keeps all server messages when incoming is identical', () => {
    const server = [
      msg('user', 'hi', { chatId: 'a' }),
      msg('char', 'hello', { chatId: 'b' }),
    ];
    const incoming = [
      msg('user', 'hi', { chatId: 'a' }),
      msg('char', 'hello', { chatId: 'b' }),
    ];
    expect(mergeMessages(server, incoming)).toEqual(server);
  });

  it('preserves server messages that stale client is missing (THE main scenario)', () => {
    const server = [
      msg('user', 'hi', { chatId: 'a' }),
      msg('char', 'hello', { chatId: 'b' }),
      msg('user', 'how are you?', { chatId: 'c' }),
      msg('char', 'good!', { chatId: 'd' }),
    ];
    const incoming = [
      msg('user', 'hi', { chatId: 'a' }),
      msg('char', 'hello', { chatId: 'b' }),
    ];
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(4);
    expect(result[2].chatId).toBe('c');
    expect(result[3].chatId).toBe('d');
  });

  it('adds new messages from incoming that server does not have', () => {
    const server = [
      msg('user', 'hi', { chatId: 'a' }),
    ];
    const incoming = [
      msg('user', 'hi', { chatId: 'a' }),
      msg('char', 'response', { chatId: 'new' }),
    ];
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].chatId).toBe('new');
  });

  it('inserts time-based messages at the correct position', () => {
    const server = [
      msg('user', 'first', { chatId: 'a', time: 100 }),
      msg('char', 'second', { chatId: 'b', time: 300 }),
    ];
    const incoming = [
      msg('user', 'first', { chatId: 'a', time: 100 }),
      msg('user', 'middle', { chatId: 'c', time: 200 }),
      msg('char', 'second', { chatId: 'b', time: 300 }),
    ];
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(3);
    expect(result[0].chatId).toBe('a');
    expect(result[1].chatId).toBe('c');
    expect(result[2].chatId).toBe('b');
  });

  it('handles messages without chatId using fingerprint matching', () => {
    const server = [
      msg('user', 'hello'),
      msg('char', 'world'),
      msg('user', 'new message'),
    ];
    const incoming = [
      msg('user', 'hello'),
      msg('char', 'world'),
    ];
    // incoming is missing 'new message' but has no chatId — fingerprint mismatch at index 2
    // server[2] fingerprint: "2:user:new message"
    // incoming has no index 2 → no collision → server msgs preserved
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(3);
    expect(result[2].data).toBe('new message');
  });

  it('does not duplicate messages matched by fingerprint', () => {
    const server = [
      msg('user', 'hello'),
      msg('char', 'world'),
    ];
    const incoming = [
      msg('user', 'hello'),
      msg('char', 'world'),
    ];
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(2);
  });

  it('appends messages without time at the end', () => {
    const server = [
      msg('user', 'first', { chatId: 'a', time: 100 }),
    ];
    const incoming = [
      msg('user', 'first', { chatId: 'a', time: 100 }),
      msg('char', 'no-time', { chatId: 'b' }),
    ];
    const result = mergeMessages(server, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].chatId).toBe('b');
  });
});
