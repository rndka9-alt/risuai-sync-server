import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trustedClients, TRUST_GRACE_PERIOD_MS } from '../../serverState';
import { isTrustedClient } from './isTrustedClient';

describe('isTrustedClient', () => {
  beforeEach(() => {
    trustedClients.clear();
    vi.restoreAllMocks();
  });

  it('returns false for null clientId', () => {
    expect(isTrustedClient(null)).toBe(false);
  });

  it('returns false for unknown clientId', () => {
    expect(isTrustedClient('unknown')).toBe(false);
  });

  it('returns true for recently trusted clientId', () => {
    trustedClients.set('abc', Date.now());
    expect(isTrustedClient('abc')).toBe(true);
  });

  it('returns false and cleans up expired clientId', () => {
    const expired = Date.now() - TRUST_GRACE_PERIOD_MS - 1;
    trustedClients.set('abc', expired);
    expect(isTrustedClient('abc')).toBe(false);
    expect(trustedClients.has('abc')).toBe(false);
  });

  it('returns true when clientId is re-trusted with updated timestamp', () => {
    trustedClients.set('abc', Date.now() - TRUST_GRACE_PERIOD_MS + 1000);
    expect(isTrustedClient('abc')).toBe(true);
  });
});
