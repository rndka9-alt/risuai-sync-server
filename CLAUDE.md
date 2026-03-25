# Sync Server

RisuAI의 sidecar 프로젝트.
RisuAI 소스코드를 수정하지 않고, 프록시 레이어와 플러그인 클라이언트만으로 동기화를 구현한다.

## 런타임 환경

- **RisuAI를 Docker(Node 서버)로 구동하는 환경을 전제로 한다.**
- Node 서버 모드에서는 `globalThis.__NODE__ = true`가 주입되어, 브라우저에서 `isNodeServer = true`로 동작한다.
- 이 때문에 RisuAI 클라이언트의 저장 방식이 브라우저 단독 환경과 다르다:
  - 캐릭터 데이터는 `POST /api/write` (`file-path: remotes/{charId}.local.bin`)로 **별도 요청**으로 저장된다.
  - 메인 바이너리(`database/database.bin`)에는 캐릭터 실제 데이터 대신 REMOTE 메타데이터 블록(type 6)만 포함된다.

## 설계 우선순위

1. **P1 — 투명성**: risuai와의 통신이 반드시 성공해야 한다. 이 서버에 장애가 생겨도 클라이언트 요청은 risuai까지 도달해야 한다. risuai의 기존 HTTP API 인터페이스를 변경하거나 훼손하지 않는다.
2. **P2 — 독립 동작**: risuai + 이 서버만으로 완전히 동작해야 한다. DB Proxy 등 다른 사이드카 없이도 모든 기능이 정상 작동한다.
3. **P3 — 체이닝 호환**: Caddy 리버스 프록시, DB Proxy 등과 함께 사용될 때에도 정상 동작해야 한다.

## 핵심 제약

- **RisuAI 본체는 수정할 수 없다.** 제3자가 관리하는 별도 프로젝트이므로, sync 관련 기능/문제는 반드시 이 프로젝트(risu-files/custom-codes/sync/) 내에서 해결해야 한다.
- 클라이언트 코드는 RisuAI 플러그인으로 실행된다. `__pluginApis__`를 통해 DB에 접근하며, 플러그인 API의 제약(예: `allowedDbKeys` 화이트리스트)을 받는다.

## Docker 실행

Docker 구성은 `risu-files/custom-codes/risuai-network/` 레포에서 관리한다.
이 프로젝트 단독으로 `docker build/run`하지 않고, network 레포의 `docker-compose.yml`로 실행한다.

## Git

- 커밋 시 `/commit-with-context`를 사용하여 의사결정 컨텍스트를 보존한다.
- 후속 작업 시 `git log`를 확인하여 기존 결정 배경과 기각된 방향을 참조한다.

## 코딩 컨벤션

- TypeScript에서 `as` 타입단언을 사용하지 않는다. interface의 index signature, 제네릭, 타입 가드 등으로 해결한다.

### 유틸 함수 구조

함수 하나당 1개의 파일. `src/utils/` 하위에 배치한다.

```
src/utils/someFunc/
├── index.ts          ← export 문만 (외부 공개 인터페이스)
├── someFunc.ts       ← 실제 구현체
├── types.ts          ← 구현체와 하위 유틸이 공유하는 타입 (선택)
└── utils/            ← someFunc 내부에서만 쓰는 유틸 (선택)
    └── subUtil.ts
```

규칙:
- `index.ts`에는 named re-export 문만 기재한다. 구현 코드를 넣지 않는다.
- 파일명은 camelCase로, 함수명과 일치시킨다.
- 해당 함수에서만 사용하는 타입은 구현체 파일에 함께 둘 수 있다.
- 구현체(`someFunc.ts`)와 하위 유틸(`utils/`)이 타입을 공유할 때는 `types.ts`로 분리하여 의존 방향 역전을 방지한다.
- 특정 유틸 내부에서만 쓰이는 헬퍼는 `utils/` 하위에 재귀적으로 배치한다.
- 외부에서는 `import { someFunc } from '../utils/someFunc'`로만 접근한다.

## 클라이언트 번들 변경 시 주의

- 클라이언트가 참조하는 식별자(헤더 이름, 엔드포인트 경로 등)를 변경할 때는 **반드시 cache-busting도 함께 적용**한다. CDN이 구버전 JS를 캐싱하면 코드에서 흔적이 남지 않아 디버깅이 극도로 어렵다.

## 문서

- API 엔드포인트, 환경변수, 프로젝트 구조 등 외부 인터페이스가 변경되면 README.md도 함께 업데이트한다.

## 테스트

- 신규 기능 추가, 리팩토링, 버그 수정 시 관련 테스트를 추가·수정한다.
- 테스트 파일은 소스 옆에 co-locate한다 (`parser.ts` → `parser.test.ts`).
- 코드 수정 후 반드시 `npm test`를 실행하여 전체 테스트가 통과하는지 확인한다.
