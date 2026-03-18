/** 각 포맷 파서의 공통 시그니처.
 *  매칭 실패 시 null, 성공 시 추출된 텍스트(빈 문자열 가능) 반환. */
export type FormatParser = (json: Record<string, unknown>) => string | null;
