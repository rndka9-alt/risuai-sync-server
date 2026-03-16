# Sync Server

RisuAI의 sidecar 프로젝트.
RisuAI 소스코드를 수정하지 않고, 프록시 레이어와 플러그인 클라이언트만으로 동기화를 구현한다.

## 런타임 환경

- **RisuAI를 Docker(Node 서버)로 구동하는 환경을 전제로 한다.**
- Node 서버 모드에서는 `globalThis.__NODE__ = true`가 주입되어, 브라우저에서 `isNodeServer = true`로 동작한다.
- 이 때문에 RisuAI 클라이언트의 저장 방식이 브라우저 단독 환경과 다르다:
  - 캐릭터 데이터는 `POST /api/write` (`file-path: remotes/{charId}.local.bin`)로 **별도 요청**으로 저장된다.
  - 메인 바이너리(`database/database.bin`)에는 캐릭터 실제 데이터 대신 REMOTE 메타데이터 블록(type 6)만 포함된다.

## 핵심 제약

- **RisuAI 본체는 수정할 수 없다.** 제3자가 관리하는 별도 프로젝트이므로, sync 관련 기능/문제는 반드시 이 프로젝트(risu-files/custom-codes/sync/) 내에서 해결해야 한다.
- 클라이언트 코드는 RisuAI 플러그인으로 실행된다. `__pluginApis__`를 통해 DB에 접근하며, 플러그인 API의 제약(예: `allowedDbKeys` 화이트리스트)을 받는다.

## 코딩 컨벤션

- TypeScript에서 `as` 타입단언을 사용하지 않는다. interface의 index signature, 제네릭, 타입 가드 등으로 해결한다.
