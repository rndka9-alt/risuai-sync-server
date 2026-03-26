/**
 * ROOT JSON에서 전송량이 큰 중복 필드를 제거한다.
 * - root.modules → 삭제 (MODULES 블록(type 5)에 동일 데이터 존재)
 *
 * MODULES 블록은 reassembleRisuSave에서 byte-for-byte 보존되고,
 * RisuAI encoder도 ROOT에서 modules를 제외하므로 write 시 데이터 유실 없음.
 *
 * @returns 수정된 JSON 문자열. modules가 없으면 원본 그대로 반환.
 */
export function stripHeavyFields(rootJson: string): string {
  const root: Record<string, unknown> = JSON.parse(rootJson);

  if (root.modules === undefined || root.modules === null) {
    return rootJson;
  }

  delete root.modules;
  return JSON.stringify(root);
}
