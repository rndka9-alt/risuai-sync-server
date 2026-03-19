/**
 * risu-auth 토큰 캡처 모듈.
 *
 * RisuAI 클라이언트가 fetch에 실어 보내는 risu-auth JWT를
 * monkey-patch된 fetch에서 캡처하여, WS 연결 시 사용한다.
 */

let latestToken: string | null = null;
let notifyReady: (() => void) | null = null;

const readyPromise: Promise<void> = new Promise((resolve) => {
  notifyReady = resolve;
});

/** fetch에서 캡처한 risu-auth 토큰을 저장 */
export function capture(token: string): void {
  latestToken = token;
  if (notifyReady) {
    notifyReady();
    notifyReady = null;
  }
}

/** 가장 최근에 캡처된 토큰 반환 (없으면 null) */
export function getToken(): string | null {
  return latestToken;
}

/** 최초 토큰이 캡처될 때까지 대기 */
export function waitForToken(): Promise<void> {
  return readyPromise;
}
