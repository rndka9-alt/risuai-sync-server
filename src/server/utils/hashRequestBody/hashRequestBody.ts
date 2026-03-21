import crypto from 'crypto';

/** /proxy2 요청의 body + targetUrl을 SHA-256 해싱하여 캐시 키 생성 */
export function hashRequestBody(body: Buffer, targetUrl: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(targetUrl);
  hash.update('\0');
  hash.update(body);
  return hash.digest('hex');
}
