'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { BLOCK_TYPE, SAFE_ROOT_KEYS } = require('./blockTypes');

const CLIENT_DIR = path.join(__dirname, 'client');

// 파일 순서 중요: 의존 관계 순
const CLIENT_FILES = [
  'notification.js',  // showNotification (sync.js, ws.js 에서 사용)
  'sync.js',          // handleBlocksChanged, catchUpFromServer (ws.js 에서 사용)
  'ws.js',            // connect, scheduleReconnect (fetch.js 이후 init)
  'fetch.js',         // fetch monkey-patch (독립)
];

// 시작 시 한번만 읽어서 캐싱
const clientParts = CLIENT_FILES.map((name) =>
  fs.readFileSync(path.join(CLIENT_DIR, name), 'utf-8')
);

function buildClientJs() {
  const header = [
    '(function () {',
    "'use strict';",
    '',
    '// --- Config (서버가 주입) ---',
    'var SYNC_TOKEN = ' + JSON.stringify(config.SYNC_TOKEN) + ';',
    'var DB_PATH = ' + JSON.stringify(config.DB_PATH) + ';',
    'var BLOCK_TYPE = ' + JSON.stringify(BLOCK_TYPE) + ';',
    'var SAFE_ROOT_KEYS = ' + JSON.stringify(SAFE_ROOT_KEYS) + ';',
    'var CLIENT_ID = Math.random().toString(36).substring(2) + Date.now().toString(36);',
    '',
    '// --- Shared state ---',
    'var lastVersion = 0;',
    'var isFirstConnect = true;',
    'var ws = null;',
    'var reconnectDelay = 1000;',
    'var MAX_RECONNECT_DELAY = 30000;',
    'var reconnectTimer = null;',
    'var notificationEl = null;',
    'var dismissTimer = null;',
    '',
  ].join('\n');

  const footer = '\nconnect();\n})();\n';

  return header + clientParts.join('\n\n') + footer;
}

module.exports = { buildClientJs };
