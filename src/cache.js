'use strict';

const config = require('./config');

// ---------------------------------------------------------------------------
// Hash cache (항상 메모리에 유지, 용량 무시 가능)
// ---------------------------------------------------------------------------
const hashCache = new Map(); // name → { type, hash }

// ---------------------------------------------------------------------------
// Data cache (LRU eviction, 용량 제한)
// ---------------------------------------------------------------------------
class SizedCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map(); // name → { data, size }
    this.currentSize = 0;
  }

  set(name, jsonStr) {
    const size = Buffer.byteLength(jsonStr, 'utf-8');
    if (this.cache.has(name)) {
      this.currentSize -= this.cache.get(name).size;
      this.cache.delete(name);
    }
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value;
      this.currentSize -= this.cache.get(oldest).size;
      this.cache.delete(oldest);
    }
    if (size > this.maxSize) return;
    this.cache.set(name, { data: jsonStr, size });
    this.currentSize += size;
  }

  get(name) {
    const entry = this.cache.get(name);
    if (!entry) return null;
    // LRU: move to end
    this.cache.delete(name);
    this.cache.set(name, entry);
    return entry.data;
  }

  delete(name) {
    if (this.cache.has(name)) {
      this.currentSize -= this.cache.get(name).size;
      this.cache.delete(name);
    }
  }
}

const dataCache = new SizedCache(config.MAX_CACHE_SIZE);

// ---------------------------------------------------------------------------
// 내부 상태
// ---------------------------------------------------------------------------
let cachedDirectory = [];
let cacheInitialized = false;
let currentVersion = 0;
const changeLog = []; // [{ version, timestamp, changed, deleted }]

// ---------------------------------------------------------------------------
// 변경 로그
// ---------------------------------------------------------------------------
function addChangeLogEntry(changed, deleted) {
  currentVersion++;
  changeLog.push({
    version: currentVersion,
    timestamp: Date.now(),
    changed,
    deleted,
  });
  while (changeLog.length > config.MAX_LOG_ENTRIES) {
    changeLog.shift();
  }
  return currentVersion;
}

/**
 * since 이후의 변경분을 반환.
 * @returns {{ status: number, data: object }}
 */
function getChangesSince(since) {
  if (changeLog.length === 0 || since >= currentVersion) {
    return { status: 200, data: { currentVersion, changes: [] } };
  }
  const oldestVersion = changeLog[0].version;
  if (since > 0 && since < oldestVersion) {
    return { status: 410, data: { error: 'version_expired', currentVersion } };
  }
  const changes = changeLog.filter((entry) => entry.version > since);
  return { status: 200, data: { currentVersion, changes } };
}

function getManifest() {
  const entries = [];
  for (const [name, { type, hash }] of hashCache) {
    entries.push({ name, type, hash });
  }
  return {
    version: currentVersion,
    cacheInitialized,
    blocks: entries,
    directory: cachedDirectory,
  };
}

module.exports = {
  hashCache,
  dataCache,

  get cachedDirectory() { return cachedDirectory; },
  set cachedDirectory(v) { cachedDirectory = v; },

  get cacheInitialized() { return cacheInitialized; },
  set cacheInitialized(v) { cacheInitialized = v; },

  get currentVersion() { return currentVersion; },

  addChangeLogEntry,
  getChangesSince,
  getManifest,
};
