import http from 'http';
import * as config from '../../config';
import * as logger from '../../logger';

/**
 * risu-auth JWT를 upstream RisuAI 서버에 포워딩하여 검증한다.
 * upstream의 GET /api/test_auth 응답이 { status: 'success' }이면 인증 통과.
 */
export function verifyRisuAuth(token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: config.UPSTREAM.hostname,
        port: config.UPSTREAM.port,
        path: '/api/test_auth',
        method: 'GET',
        headers: { 'risu-auth': token },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const data: Record<string, unknown> = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(data.status === 'success');
          } catch {
            resolve(false);
          }
        });
      },
    );

    req.on('error', (err) => {
      logger.error('risu-auth verification failed', { error: err.message });
      resolve(false);
    });

    req.setTimeout(5000, () => {
      logger.warn('risu-auth verification timed out');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}
