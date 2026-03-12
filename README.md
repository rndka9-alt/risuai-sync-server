# RisuAI Sync Server

RisuAI Node 서버 앞에 위치하는 리버스 프록시로, 여러 기기에서 동일한 RisuAI 인스턴스에 접속할 때 데이터를 실시간으로 동기화한다.

RisuAI 소스코드를 수정하지 않고, 프록시 레이어에서 동기화를 구현한다.

## 실시간 동기화 범위

### 페이지 새로고침 없이 반영되는 것 (블록 동기화)

- 기존 캐릭터의 채팅 메시지 추가/수정
- 기존 캐릭터의 설정 변경 (이름, 설명, 시스템 프롬프트, 로어북 등)
- 캐릭터 내부의 모든 데이터 변경

### 새로고침 알림이 표시되는 것 (fallback)

- 캐릭터 추가/삭제
- 글로벌 설정 변경 (API 키, 테마, 모델 등)
- 봇 프리셋 변경
- 모듈 변경
- REMOTE 블록이 포함된 저장 (Tauri/데스크톱 앱에서 생성)

### 지원하지 않는 것

- AI 응답 스트리밍 중간 상태의 실시간 공유
- 동시 편집 시 충돌 감지/해결

## 동작 원리

### 전체 아키텍처

```
브라우저 A ──┐
             ├── sync-server (:3000) ── RisuAI (:6001)
브라우저 B ──┘       │
                WebSocket 연결
```

sync-server는 RisuAI 앞에서 리버스 프록시로 동작한다.
TLS 종단이나 가용성 fallback은 앞단 로드밸런서에서 별도로 구성한다.

### 동기화 플로우

```
1. 페이지 로드
   브라우저 → GET / → sync-server가 RisuAI 응답에 <script> 주입 → 클라이언트 JS 로드
   클라이언트 JS → WebSocket 연결 → 현재 version 수신

2. 캐릭터 수정 (브라우저 A)
   RisuAI 내부 $effect → 500ms debounce → POST /api/write (database.bin 전체)
                                                  │
                                           sync-server가 가로챔
                                                  │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                              upstream 전달   바이너리 파싱   SHA-256 해시 비교
                              (RisuAI 저장)  (블록 추출)    (변경분 감지)
                                                                  │
                                                  변경된 블록만 WebSocket broadcast
                                                  (blocks-changed 메시지)
                                                                  │
                                                          ┌───────┘
                                                          ▼
3. 동기화 수신 (브라우저 B)
   blocks-changed 수신 → 캐릭터 블록만 GET /sync/block 으로 fetch
                       → db.characters[idx] 직접 교체
                       → Svelte 반응성으로 UI 자동 갱신
                       → 비캐릭터 변경이면 새로고침 알림 표시

4. 재연결 시 catch-up
   WebSocket 끊김 → 재연결 → GET /sync/changes?since={lastVersion}
                           → 놓친 변경분 일괄 적용

5. Echo 방지
   브라우저 B가 동기화 데이터를 받아 적용 → $effect 트리거 → 재저장 발생
   → sync-server가 해시 비교 → 동일 → broadcast 안 함 (루프 차단)
```

## 프로젝트 구조

```
sync/
├── server.js                  # 엔트리포인트 (HTTP/WS 서버, 프록시)
├── src/
│   ├── config.js              # 환경변수 로딩, 설정 상수
│   ├── parser.js              # RisuSave 바이너리 파서
│   ├── cache.js               # 블록 해시 캐시, 데이터 캐시 (LRU), 변경 로그
│   ├── sync.js                # 동기화 핵심 로직 (파싱, 비교, broadcast)
│   ├── client-builder.js      # 클라이언트 JS 파일 결합 및 설정 주입
│   └── client/                # 브라우저에서 실행되는 클라이언트 코드
│       ├── notification.js    # 새로고침 알림 UI
│       ├── sync.js            # 블록 동기화 핸들러, catch-up 로직
│       ├── ws.js              # WebSocket 연결/재연결, visibilitychange
│       └── fetch.js           # fetch monkey-patch (클라이언트 ID 헤더 주입)
├── Dockerfile
├── package.json
└── .env                       # 환경 설정 (gitignore 대상)
```

### 서버 모듈 의존 관계

```
config ← parser
     ↖     ↙
      cache
        ↑
       sync ← server.js (엔트리포인트)
```

### 클라이언트 결합 순서

`client-builder.js`가 `src/client/*.js` 파일을 읽어 하나의 IIFE로 결합한다.
서버 설정값(`SYNC_TOKEN`, `DB_PATH`)은 결합 시 `JSON.stringify`로 주입된다.

```
(function() {
  'use strict';
  var SYNC_TOKEN = "...";  // 서버가 주입
  var DB_PATH = "...";     // 서버가 주입
  // ... shared state ...

  // notification.js → sync.js → ws.js → fetch.js (의존 순서대로 결합)

  connect();
})();
```

## 실행 방법

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t risu-sync .
docker run -d -p 3000:3000 \
  -e UPSTREAM=http://risuai:6001 \
  -e SYNC_TOKEN=your-secret \
  risu-sync
```

### 단독 실행

```bash
cd risu-files/custom-codes/sync
cp .env.example .env   # 설정 편집
npm install
node server.js
```

브라우저에서 RisuAI 대신 sync-server 주소(`http://localhost:3000`)로 접속한다.

## 환경 설정

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | sync-server 리스닝 포트 |
| `UPSTREAM` | `http://localhost:6001` | RisuAI 서버 주소 |
| `SYNC_TOKEN` | (자동 생성) | WebSocket 인증 토큰. 미설정 시 서버 시작마다 랜덤 생성 |
| `DB_PATH` | `database/database.bin` | RisuAI 데이터베이스 파일 경로 |
| `MAX_CACHE_SIZE` | `104857600` (100MB) | 블록 데이터 캐시 최대 크기 (바이트) |
| `MAX_LOG_ENTRIES` | `1000` | 변경 로그 최대 항목 수 |

## API 엔드포인트

| 경로 | 설명 |
|------|------|
| `GET /sync/client.js` | 클라이언트 JS (설정 주입됨) |
| `GET /sync/health` | 서버 상태 (클라이언트 수, 버전, 캐시 상태) |
| `GET /sync/block?name={name}` | 캐시된 블록 JSON 반환 |
| `GET /sync/changes?since={version}` | 지정 버전 이후 변경 로그 |
| `GET /sync/manifest` | 전체 블록 해시 목록 (디버깅용) |
| `WS /sync/ws?token={token}&clientId={id}` | WebSocket 연결 |
