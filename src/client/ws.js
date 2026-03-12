// ---------------------------------------------------------------------------
// WebSocket 연결
// ---------------------------------------------------------------------------
function connect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url =
    protocol + '//' + location.host +
    '/sync/ws?token=' + encodeURIComponent(SYNC_TOKEN) +
    '&clientId=' + encodeURIComponent(CLIENT_ID);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = function () {
    console.log('[Sync] Connected');
    reconnectDelay = 1000;

    if (isFirstConnect) {
      // 첫 연결: 현재 버전만 가져옴
      fetch('/sync/changes?since=0')
        .then(function (r) { return r.json(); })
        .then(function (data) { lastVersion = data.currentVersion; })
        .catch(function () {});
      isFirstConnect = false;
      return;
    }

    // 재연결: 놓친 변경분 catch-up
    catchUpFromServer();
  };

  ws.onmessage = function (event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === 'blocks-changed') {
        lastVersion = msg.version || lastVersion;
        handleBlocksChanged(msg);
      } else if (msg.type === 'version-update') {
        lastVersion = msg.version || lastVersion;
      } else if (msg.type === 'db-changed') {
        showNotification(); // Phase 1 fallback
      }
    } catch (e) {
      // 파싱 실패 무시
    }
  };

  ws.onclose = function () {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = function () {
    // onclose가 뒤따라 호출됨
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ---------------------------------------------------------------------------
// visibilitychange: 탭 복귀 시 catch-up
// ---------------------------------------------------------------------------
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && lastVersion > 0) {
    catchUpFromServer();
  }
});
