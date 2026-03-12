'use strict';

const { parseRisuSaveBlocks } = require('./parser');
const cache = require('./cache');
const config = require('./config');

// server.js 에서 init()으로 주입
let clients = null;

function init(clientsMap) {
  clients = clientsMap;
}

// ---------------------------------------------------------------------------
// DB write 감지
// ---------------------------------------------------------------------------
function hexDecode(hex) {
  let s = '';
  for (let i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return s;
}

function isDbWrite(req) {
  if (req.method !== 'POST' || req.url !== '/api/write') return false;
  const fp = req.headers['file-path'];
  if (!fp) return false;
  try {
    return hexDecode(fp) === config.DB_PATH;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DB write 처리: 파싱 → 해시 비교 → broadcast
// ---------------------------------------------------------------------------
function processDbWrite(buffer, senderClientId) {
  const parsed = parseRisuSaveBlocks(buffer);
  if (!parsed) {
    // REMOTE 블록 또는 파싱 실패 → Phase 1 fallback
    broadcastDbChanged(senderClientId);
    return;
  }

  const { blocks, directory } = parsed;

  if (!cache.cacheInitialized) {
    // 첫 write: 캐시만 채움, broadcast 없음
    for (const [name, block] of blocks) {
      cache.hashCache.set(name, { type: block.type, hash: block.hash });
      cache.dataCache.set(name, block.json);
    }
    cache.cachedDirectory = directory;
    cache.cacheInitialized = true;
    console.log(`[Sync] Cache initialized with ${blocks.size} blocks`);
    return;
  }

  const changed = [];
  const added = [];
  const deleted = [];

  for (const [name, block] of blocks) {
    const cached = cache.hashCache.get(name);
    if (!cached) {
      added.push({ name, type: block.type });
    } else if (cached.hash !== block.hash) {
      changed.push({ name, type: block.type });
    }
    cache.hashCache.set(name, { type: block.type, hash: block.hash });
    cache.dataCache.set(name, block.json);
  }

  // 디렉토리 비교로 삭제 감지
  const newDirSet = new Set(directory);
  for (const name of cache.cachedDirectory) {
    if (!newDirSet.has(name)) {
      deleted.push(name);
      cache.hashCache.delete(name);
      cache.dataCache.delete(name);
    }
  }

  cache.cachedDirectory = directory;

  if (changed.length === 0 && added.length === 0 && deleted.length === 0) {
    return;
  }

  const version = cache.addChangeLogEntry(changed.concat(added), deleted);

  console.log(`[Sync] v${version}: ${changed.length} changed, ${added.length} added, ${deleted.length} deleted`);

  broadcast(
    { type: 'blocks-changed', version, changed, added, deleted, timestamp: Date.now() },
    senderClientId,
  );
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------
function broadcast(payload, excludeClientId) {
  const data = JSON.stringify(payload);
  for (const [id, client] of clients) {
    if (id !== excludeClientId && client.readyState === 1) {
      client.send(data);
    }
  }
}

function broadcastDbChanged(excludeClientId) {
  broadcast(
    { type: 'db-changed', file: config.DB_PATH, timestamp: Date.now() },
    excludeClientId,
  );
}

module.exports = {
  init,
  isDbWrite,
  processDbWrite,
  broadcastDbChanged,
};
