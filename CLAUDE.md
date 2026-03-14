# Sync Server

RisuAI의 sidecar 프로젝트.
RisuAI 소스코드를 수정하지 않고, 프록시 레이어와 플러그인 클라이언트만으로 동기화를 구현한다.

## 핵심 제약

- **RisuAI 본체는 수정할 수 없다.** 제3자가 관리하는 별도 프로젝트이므로, sync 관련 기능/문제는 반드시 이 프로젝트(risu-files/custom-codes/sync/) 내에서 해결해야 한다.
- 클라이언트 코드는 RisuAI 플러그인으로 실행된다. `__pluginApis__`를 통해 DB에 접근하며, 플러그인 API의 제약(예: `allowedDbKeys` 화이트리스트)을 받는다.
