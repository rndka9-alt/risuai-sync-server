// ---------------------------------------------------------------------------
// 라이브 적용 가능한 ROOT 키 화이트리스트
// ---------------------------------------------------------------------------
var SAFE_ROOT_KEYS = ['enabledModules'];

// ---------------------------------------------------------------------------
// Catch-up: 놓친 변경분 복구
// ---------------------------------------------------------------------------
function catchUpFromServer() {
  fetch('/sync/changes?since=' + lastVersion)
    .then(function (r) {
      if (r.status === 410) {
        showNotification();
        return null;
      }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      if (!data.changes || !data.changes.length) {
        lastVersion = data.currentVersion;
        return;
      }
      lastVersion = data.currentVersion;

      // 블록별 마지막 operation 추적 (changed vs deleted)
      var lastOp = {};
      data.changes.forEach(function (entry) {
        (entry.changed || []).forEach(function (b) {
          lastOp[b.name] = { op: 'changed', block: b };
        });
        (entry.deleted || []).forEach(function (name) {
          lastOp[name] = { op: 'deleted' };
        });
      });

      var allChanged = [];
      var allDeleted = [];
      Object.keys(lastOp).forEach(function (name) {
        if (lastOp[name].op === 'changed') {
          allChanged.push(lastOp[name].block);
        } else {
          allDeleted.push(name);
        }
      });

      handleBlocksChanged({
        changed: allChanged,
        added: [],
        deleted: allDeleted,
      });
    })
    .catch(function () {});
}

// ---------------------------------------------------------------------------
// ROOT 블록의 safe key만 변경되었는지 확인
// ---------------------------------------------------------------------------
function isRootSafeChange(block) {
  // changedKeys가 없으면 (서버가 감지 못함) → unsafe
  if (!block.changedKeys || !Array.isArray(block.changedKeys)) return false;
  if (block.changedKeys.length === 0) return false;
  for (var i = 0; i < block.changedKeys.length; i++) {
    if (SAFE_ROOT_KEYS.indexOf(block.changedKeys[i]) === -1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// ROOT safe key 라이브 적용
// ---------------------------------------------------------------------------
function applyRootSafeKeys(db, rootData, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (rootData[key] !== undefined) {
      db[key] = rootData[key];
    }
  }
}

// ---------------------------------------------------------------------------
// 블록 단위 동기화 핸들러
// ---------------------------------------------------------------------------
function handleBlocksChanged(msg) {
  // 캐릭터 추가/삭제 → 새로고침 (목록 갱신, 대용량 카드 등 고려)
  if ((msg.added && msg.added.length) || (msg.deleted && msg.deleted.length)) {
    showNotification();
    return;
  }

  if (!globalThis.__pluginApis__) {
    showNotification();
    return;
  }

  var db;
  try {
    db = globalThis.__pluginApis__.getDatabase();
  } catch (e) {
    showNotification();
    return;
  }

  var needsReload = false;

  // 기존 캐릭터 수정만 블록 동기화 (type 2=WITH_CHAT, 7=WITHOUT_CHAT)
  var charBlocks = (msg.changed || [])
    .filter(function (b) { return b.type === 2 || b.type === 7; });

  // ROOT 블록 중 safe key만 변경된 것 분류
  var safeRootBlocks = [];

  (msg.changed || []).forEach(function (b) {
    if (b.type === 0) return; // CONFIG 무시
    if (b.type === 2 || b.type === 7) return; // 캐릭터는 위에서 처리
    if (b.type === 1 && isRootSafeChange(b)) {
      safeRootBlocks.push(b);
      return;
    }
    // 그 외 (unsafe ROOT, BOTPRESET, MODULES 등) → reload
    needsReload = true;
  });

  // 캐릭터 블록 + safe ROOT 블록 병렬 fetch
  var charFetches = charBlocks.map(function (b) {
    return fetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return { type: 'char', name: b.name, data: data }; })
      .catch(function () { return { type: 'char', name: b.name, data: null }; });
  });

  var rootFetches = safeRootBlocks.map(function (b) {
    return fetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return { type: 'root', block: b, data: data }; })
      .catch(function () { return { type: 'root', block: b, data: null }; });
  });

  Promise.all(charFetches.concat(rootFetches)).then(function (results) {
    results.forEach(function (r) {
      if (r.type === 'char') {
        if (!r.data) { needsReload = true; return; }
        var idx = db.characters.findIndex(function (c) { return c.chaId === r.name; });
        if (idx !== -1) {
          db.characters[idx] = r.data;
        } else {
          needsReload = true;
        }
      } else if (r.type === 'root') {
        if (!r.data) { needsReload = true; return; }
        applyRootSafeKeys(db, r.data, r.block.changedKeys);
      }
    });

    if (needsReload) {
      showNotification();
    }
  });
}
