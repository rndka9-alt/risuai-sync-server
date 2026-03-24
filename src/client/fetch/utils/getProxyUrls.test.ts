import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SYNC_PLUGIN_NAME, PROXY_URLS_ARG_KEY } from '../../../shared/syncMarker';

describe('getProxyUrls', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__pluginApis__;
  });

  async function loadGetProxyUrls() {
    const mod = await import('./getProxyUrls');
    return mod.getProxyUrls;
  }

  it('__pluginApis__가 없으면 빈 배열을 반환한다', async () => {
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual([]);
  });

  it('플러그인이 없으면 빈 배열을 반환한다', async () => {
    (globalThis as Record<string, unknown>).__pluginApis__ = {
      getDatabase: () => ({ plugins: [] }),
    };
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual([]);
  });

  it('urls가 비어있으면 빈 배열을 반환한다', async () => {
    (globalThis as Record<string, unknown>).__pluginApis__ = {
      getDatabase: () => ({
        plugins: [{
          name: SYNC_PLUGIN_NAME,
          enabled: true,
          realArg: { [PROXY_URLS_ARG_KEY]: '' },
        }],
      }),
    };
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual([]);
  });

  it('줄바꿈으로 구분된 URL 목록을 파싱한다', async () => {
    (globalThis as Record<string, unknown>).__pluginApis__ = {
      getDatabase: () => ({
        plugins: [{
          name: SYNC_PLUGIN_NAME,
          enabled: true,
          realArg: { [PROXY_URLS_ARG_KEY]: 'https://api.example.com\nhttps://other.com/v1' },
        }],
      }),
    };
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual(['https://api.example.com', 'https://other.com/v1']);
  });

  it('빈 줄과 공백을 무시한다', async () => {
    (globalThis as Record<string, unknown>).__pluginApis__ = {
      getDatabase: () => ({
        plugins: [{
          name: SYNC_PLUGIN_NAME,
          enabled: true,
          realArg: { [PROXY_URLS_ARG_KEY]: '  https://a.com  \n\n  \nhttps://b.com\n' },
        }],
      }),
    };
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('비활성화된 플러그인은 무시한다', async () => {
    (globalThis as Record<string, unknown>).__pluginApis__ = {
      getDatabase: () => ({
        plugins: [{
          name: SYNC_PLUGIN_NAME,
          enabled: false,
          realArg: { [PROXY_URLS_ARG_KEY]: 'https://a.com' },
        }],
      }),
    };
    const getProxyUrls = await loadGetProxyUrls();
    expect(getProxyUrls()).toEqual([]);
  });
});
