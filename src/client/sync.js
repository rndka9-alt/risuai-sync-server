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

  // 캐릭터가 아닌 변경(ROOT, BOTPRESET, MODULES 등) → reload 필요
  // type 0 (CONFIG) 은 무시 (버전 메타데이터일 뿐)
  (msg.changed || []).forEach(function (b) {
    if (b.type !== 2 && b.type !== 7 && b.type !== 0) {
      needsReload = true;
    }
  });

  // 캐릭터 블록들을 병렬 fetch
  var fetches = charBlocks.map(function (b) {
    return fetch('/sync/block?name=' + encodeURIComponent(b.name))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return { name: b.name, data: data }; })
      .catch(function () { return { name: b.name, data: null }; });
  });

  Promise.all(fetches).then(function (results) {
    results.forEach(function (r) {
      if (!r.data) { needsReload = true; return; }
      var idx = db.characters.findIndex(function (c) { return c.chaId === r.name; });
      if (idx !== -1) {
        db.characters[idx] = r.data;
      } else {
        // 캐시에는 있었지만 로컬에 없는 캐릭터 → 새로고침
        needsReload = true;
      }
    });

    if (needsReload) {
      showNotification();
    }
  });
}
