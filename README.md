# RisuAI Sync Server

RisuAI Node 서버 앞에 위치하는 리버스 프록시로, 여러 기기에서 동일한 RisuAI 인스턴스에 접속할 때 데이터를 실시간으로 동기화한다.

RisuAI 소스코드를 수정하지 않고, 프록시 레이어에서 동기화를 구현한다.

## 실시간 동기화 범위

### 페이지 새로고침 없이 반영되는 것 (블록 동기화)

- 기존 캐릭터의 채팅 메시지 추가/수정
- 기존 캐릭터의 설정 변경 (이름, 설명, 시스템 프롬프트, 로어북 등)
- 캐릭터 내부의 모든 데이터 변경
- 모듈 토글 on/off (enabledModules)

### 새로고침 알림이 표시되는 것 (fallback)

- 캐릭터 추가/삭제
- 글로벌 설정 변경 (API 키, 테마, 모델 등)
- 봇 프리셋 변경
- 모듈 추가/삭제/내용 변경
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
   blocks-changed 수신 → 변경 유형별 분기:
     캐릭터 블록     → GET /sync/block → db.characters[idx] 직접 교체 → UI 자동 갱신
     ROOT safe key  → changedKeys 확인 → enabledModules만 변경 시 라이브 적용
     그 외          → 새로고침 알림 표시

4. 재연결 시 catch-up
   WebSocket 끊김 → 재연결 → GET /sync/changes?since={lastVersion}&clientId={id}
                           → 놓친 변경분 일괄 적용 (자기 변경분은 서버에서 제외)

5. Echo 방지
   브라우저 B가 동기화 데이터를 받아 적용 → $effect 트리거 → 재저장 발생
   → sync-server가 해시 비교 → 동일 → broadcast 안 함 (루프 차단)
```

## 프로젝트 구조

```
├── build.js                     # esbuild 빌드 스크립트
├── tsconfig.json                # TypeScript 설정
├── src/
│   ├── server/                  # 서버 코드 (Node.js)
│   │   ├── index.ts             # 엔트리포인트 (HTTP/WS 서버, 프록시)
│   │   ├── config.ts            # 환경변수 로딩, 설정 상수
│   │   ├── parser.ts            # RisuSave 바이너리 파서
│   │   ├── cache.ts             # 블록 해시 캐시, 데이터 캐시 (LRU), 변경 로그
│   │   ├── sync.ts              # 동기화 핵심 로직 (파싱, 비교, broadcast)
│   │   └── client-bundle.ts     # esbuild로 클라이언트 JS 번들링
│   ├── client/                  # 브라우저에서 실행되는 클라이언트 코드
│   │   ├── index.ts             # 클라이언트 엔트리포인트
│   │   ├── config.ts            # 클라이언트 설정 (서버에서 주입)
│   │   ├── state.ts             # 공유 상태 관리
│   │   ├── notification.ts      # 새로고침 알림 UI
│   │   ├── sync.ts              # 블록 동기화 핸들러, catch-up 로직
│   │   ├── ws.ts                # WebSocket 연결/재연결, visibilitychange
│   │   └── fetch.ts             # fetch monkey-patch (클라이언트 ID 헤더 주입)
│   └── shared/                  # 서버/클라이언트 공유 코드
│       ├── types.ts             # 메시지, API 응답 타입 정의
│       └── blockTypes.ts        # 블록 타입 상수, safe key 정의
├── Dockerfile
├── package.json
└── .env                         # 환경 설정 (gitignore 대상)
```

### 서버 모듈 의존 관계

```
config ← parser
     ↖     ↙
      cache
        ↑
       sync ← index.ts (엔트리포인트)
```

### 클라이언트 번들링

`client-bundle.ts`가 esbuild를 사용하여 `src/client/index.ts`를 IIFE로 번들링한다.
서버 설정값(`SYNC_TOKEN`, `DB_PATH`, `CLIENT_ID`)은 번들 시 define으로 주입된다.

## 실행 방법

### Docker

```bash
docker build -t risu-sync .
docker run -d -p 3000:3000 \
  -e UPSTREAM=http://risuai:6001 \
  -e SYNC_TOKEN=your-secret \
  risu-sync
```

### 단독 실행

```bash
cp .env.example .env   # 설정 편집
npm install
npm run build
npm start
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
| `GET /sync/changes?since={version}&clientId={id}` | 지정 버전 이후 변경 로그 (자기 변경분 제외) |
| `GET /sync/manifest` | 전체 블록 해시 목록 (디버깅용) |
| `WS /sync/ws?token={token}&clientId={id}` | WebSocket 연결 |
