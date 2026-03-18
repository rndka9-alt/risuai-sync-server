import { describe, it, expect, beforeEach } from 'vitest';
import { clients, freshClients } from '../../serverState';
import { isClientFresh } from './freshness';

describe('isClientFresh', () => {
  beforeEach(() => {
    clients.clear();
    freshClients.clear();
  });

  it('returns false for null clientId', () => {
    expect(isClientFresh(null)).toBe(false);
  });

  it('returns false if client is not connected', () => {
    freshClients.add('abc');
    expect(isClientFresh('abc')).toBe(false);
  });

  it('returns false if client is connected but not caught up', () => {
    clients.set('abc', {} as never);
    expect(isClientFresh('abc')).toBe(false);
  });

  it('returns true if client is connected and caught up', () => {
    clients.set('abc', {} as never);
    freshClients.add('abc');
    expect(isClientFresh('abc')).toBe(true);
  });
});
