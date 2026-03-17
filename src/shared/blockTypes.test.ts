import { describe, it, expect } from 'vitest';
import {
  BLOCK_TYPE,
  isBlockType,
  isSyncedRootKey,
  isIgnoredRootKey,
  isSafeRootKey,
  SYNCED_ROOT_KEYS,
  IGNORED_ROOT_KEYS,
} from './blockTypes';

describe('isBlockType', () => {
  it('accepts all defined block type values', () => {
    for (const value of Object.values(BLOCK_TYPE)) {
      expect(isBlockType(value)).toBe(true);
    }
  });

  it('rejects values outside defined range', () => {
    expect(isBlockType(-1)).toBe(false);
    expect(isBlockType(9)).toBe(false);
    expect(isBlockType(100)).toBe(false);
  });
});

describe('isSyncedRootKey', () => {
  it.each([
    'apiType', 'temperature', 'mainPrompt', 'openAIKey',
    'enabledModules', 'characterOrder', 'plugins', 'username',
  ])('returns true for synced key "%s"', (key) => {
    expect(isSyncedRootKey(key)).toBe(true);
  });

  it.each([
    'saveTime', 'genTime', '__directory', 'nonExistentKey123',
  ])('returns false for non-synced key "%s"', (key) => {
    expect(isSyncedRootKey(key)).toBe(false);
  });
});

describe('isIgnoredRootKey', () => {
  it.each([...IGNORED_ROOT_KEYS])(
    'returns true for ignored key "%s"',
    (key) => {
      expect(isIgnoredRootKey(key)).toBe(true);
    },
  );

  it.each(['apiType', 'temperature', 'randomKey'])(
    'returns false for non-ignored key "%s"',
    (key) => {
      expect(isIgnoredRootKey(key)).toBe(false);
    },
  );
});

describe('key classification', () => {
  it('SYNCED and IGNORED sets are disjoint', () => {
    for (const key of SYNCED_ROOT_KEYS) {
      expect(IGNORED_ROOT_KEYS.has(key)).toBe(false);
    }
  });
});

describe('isSafeRootKey', () => {
  it('is an alias for isSyncedRootKey', () => {
    expect(isSafeRootKey('apiType')).toBe(isSyncedRootKey('apiType'));
    expect(isSafeRootKey('saveTime')).toBe(isSyncedRootKey('saveTime'));
  });
});
