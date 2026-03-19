import http from 'http';
import * as logger from '../logger';

interface ClientLogBody {
  level?: string;
  message?: string;
  context?: Record<string, string>;
}

const ALLOWED_LEVELS = new Set(['info', 'warn', 'error']);

/** POST /sync/log — 클라이언트 로그를 서버에 기록 */
export function handleClientLog(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body: ClientLogBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      const level = ALLOWED_LEVELS.has(body.level || '') ? body.level! : 'info';
      logger[level as 'info' | 'warn' | 'error'](`[Client] ${body.message || ''}`, body.context || {});
    } catch { /* ignore malformed body */ }
    res.writeHead(204);
    res.end();
  });
}
