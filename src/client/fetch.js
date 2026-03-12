// ---------------------------------------------------------------------------
// fetch monkey-patch
// ---------------------------------------------------------------------------
var originalFetch = window.fetch;

function hexToStr(hex) {
  var s = '';
  for (var i = 0; i < hex.length; i += 2) {
    s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return s;
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (typeof headers === 'object') return headers[name] || null;
  return null;
}

window.fetch = function (input, init) {
  // POST /api/write 시 x-sync-client-id 헤더 추가 (sender 식별용)
  if (init && init.method === 'POST' && input === '/api/write') {
    var fp = getHeader(init.headers, 'file-path');
    if (fp) {
      try {
        var decoded = hexToStr(fp);
        if (decoded === DB_PATH) {
          if (init.headers instanceof Headers) {
            init.headers.set('x-sync-client-id', CLIENT_ID);
          } else if (init.headers && typeof init.headers === 'object') {
            init.headers['x-sync-client-id'] = CLIENT_ID;
          }
        }
      } catch (e) {
        // hex 디코딩 실패 무시
      }
    }
  }

  return originalFetch.apply(this, arguments);
};
