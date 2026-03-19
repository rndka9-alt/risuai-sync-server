import { isPrivateIPv4 } from './utils/isPrivateIPv4';

/**
 * private/internal 네트워크 주소 여부를 판정.
 * SSRF 방어: 클라이언트가 지정한 URL이 내부 네트워크로 향하는 것을 차단.
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;

  // IPv6 loopback / unspecified
  if (lower === '::1' || lower === '::') return true;
  // fc00::/7 (unique local)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe80:')) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  return isPrivateIPv4(hostname);
}
