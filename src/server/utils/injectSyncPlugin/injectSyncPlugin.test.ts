import { describe, it, expect } from 'vitest';
import { injectSyncPlugin } from './injectSyncPlugin';
import { SYNC_PLUGIN_NAME, SYNC_PLUGIN_NAME_LEGACY, SYNC_MARKER_KEY, PROXY_URLS_ARG_KEY } from '../../../shared/syncMarker';
import { REREGISTER_DELAY_MS } from './pluginScript';

describe('injectSyncPlugin', () => {
  it('빈 plugins 배열에 플러그인을 주입한다', () => {
    const root = JSON.stringify({ plugins: [] });
    const result = JSON.parse(injectSyncPlugin(root));

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].name).toBe(SYNC_PLUGIN_NAME);
    expect(result.plugins[0].enabled).toBe(true);
    expect(result.plugins[0].version).toBe('3.0');
  });

  it('플러그인 스크립트에 마커 키가 포함된다', () => {
    const root = JSON.stringify({ plugins: [] });
    const result = JSON.parse(injectSyncPlugin(root));

    expect(result.plugins[0].script).toContain(SYNC_MARKER_KEY);
  });

  it('플러그인 스크립트에 지연 재등록 로직이 포함된다', () => {
    const root = JSON.stringify({ plugins: [] });
    const result = JSON.parse(injectSyncPlugin(root));
    const script: string = result.plugins[0].script;

    expect(script).toContain('unregisterBodyIntercepter');
    expect(script).toContain(String(REREGISTER_DELAY_MS));
  });

  it('다른 플러그인이 있을 때 추가한다', () => {
    const root = JSON.stringify({
      plugins: [{ name: 'other-plugin', enabled: true }],
    });
    const result = JSON.parse(injectSyncPlugin(root));

    expect(result.plugins).toHaveLength(2);
    expect(result.plugins[0].name).toBe('other-plugin');
    expect(result.plugins[1].name).toBe(SYNC_PLUGIN_NAME);
  });

  it('동일 이름 플러그인이 있으면 수정하지 않는다', () => {
    const root = JSON.stringify({
      plugins: [{ name: SYNC_PLUGIN_NAME, enabled: true, script: 'old' }],
    });
    const result = injectSyncPlugin(root);

    expect(result).toBe(root);
  });

  it('비활성화된 플러그인의 상태를 보존한다', () => {
    const root = JSON.stringify({
      plugins: [{ name: SYNC_PLUGIN_NAME, enabled: false }],
    });
    const result = injectSyncPlugin(root);

    expect(result).toBe(root);
    expect(JSON.parse(result).plugins[0].enabled).toBe(false);
  });

  it('plugins 필드가 없으면 생성한다', () => {
    const root = JSON.stringify({ foo: 'bar' });
    const result = JSON.parse(injectSyncPlugin(root));

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].name).toBe(SYNC_PLUGIN_NAME);
    expect(result.foo).toBe('bar');
  });

  it('출력이 유효한 JSON이다', () => {
    const root = JSON.stringify({ plugins: [] });
    const result = injectSyncPlugin(root);

    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('urls textarea 속성이 포함된다', () => {
    const root = JSON.stringify({ plugins: [] });
    const result = JSON.parse(injectSyncPlugin(root));
    const plugin = result.plugins[0];

    expect(plugin.arguments[PROXY_URLS_ARG_KEY]).toBe('string');
    expect(plugin.argMeta[PROXY_URLS_ARG_KEY].textarea).toBe(true);
    expect(plugin.realArg[PROXY_URLS_ARG_KEY]).toBe('');
  });

  describe('레거시 마이그레이션', () => {
    it('이전 이름 플러그인을 새 이름으로 마이그레이션한다', () => {
      const root = JSON.stringify({
        plugins: [{ name: SYNC_PLUGIN_NAME_LEGACY, enabled: true, script: 'old' }],
      });
      const result = JSON.parse(injectSyncPlugin(root));

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0].name).toBe(SYNC_PLUGIN_NAME);
      expect(result.plugins[0].displayName).toBe(SYNC_PLUGIN_NAME);
      expect(result.plugins[0].script).toContain(SYNC_MARKER_KEY);
    });

    it('마이그레이션 시 urls 속성을 추가한다', () => {
      const root = JSON.stringify({
        plugins: [{
          name: SYNC_PLUGIN_NAME_LEGACY,
          enabled: true,
          arguments: {},
          argMeta: {},
          realArg: {},
        }],
      });
      const result = JSON.parse(injectSyncPlugin(root));
      const plugin = result.plugins[0];

      expect(plugin.arguments[PROXY_URLS_ARG_KEY]).toBe('string');
      expect(plugin.argMeta[PROXY_URLS_ARG_KEY].textarea).toBe(true);
      expect(plugin.realArg[PROXY_URLS_ARG_KEY]).toBe('');
    });

    it('마이그레이션 시 기존 enabled 상태를 보존한다', () => {
      const root = JSON.stringify({
        plugins: [{ name: SYNC_PLUGIN_NAME_LEGACY, enabled: false }],
      });
      const result = JSON.parse(injectSyncPlugin(root));

      expect(result.plugins[0].enabled).toBe(false);
    });

    it('마이그레이션 시 기존 realArg.urls 값을 보존한다', () => {
      const root = JSON.stringify({
        plugins: [{
          name: SYNC_PLUGIN_NAME_LEGACY,
          enabled: true,
          realArg: { [PROXY_URLS_ARG_KEY]: 'https://example.com' },
        }],
      });
      const result = JSON.parse(injectSyncPlugin(root));

      expect(result.plugins[0].realArg[PROXY_URLS_ARG_KEY]).toBe('https://example.com');
    });
  });
});
