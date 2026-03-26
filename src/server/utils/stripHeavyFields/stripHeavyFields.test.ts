import { describe, it, expect } from 'vitest';
import { stripHeavyFields } from './stripHeavyFields';

describe('stripHeavyFields', () => {
  it('strips modules from root', () => {
    const root = {
      modules: [{ name: 'ModA', lorebook: [] }],
      setting: 'value',
    };

    const result = JSON.parse(stripHeavyFields(JSON.stringify(root)));

    expect(result.modules).toBeUndefined();
    expect(result.setting).toBe('value');
  });

  it('returns original json when no modules key', () => {
    const json = JSON.stringify({ plugins: [], setting: 'value' });

    expect(stripHeavyFields(json)).toBe(json);
  });

  it('returns original json when modules is null', () => {
    const json = JSON.stringify({ modules: null, setting: 'value' });

    expect(stripHeavyFields(json)).toBe(json);
  });

  it('preserves all other root properties', () => {
    const root = {
      modules: [1, 2, 3],
      plugins: [{ name: 'P', script: 'x' }],
      theme: 'dark',
      fontSize: 14,
      nested: { a: { b: 'c' } },
    };

    const result = JSON.parse(stripHeavyFields(JSON.stringify(root)));

    expect(result.modules).toBeUndefined();
    expect(result.plugins).toEqual([{ name: 'P', script: 'x' }]);
    expect(result.theme).toBe('dark');
    expect(result.fontSize).toBe(14);
    expect(result.nested).toEqual({ a: { b: 'c' } });
  });
});
