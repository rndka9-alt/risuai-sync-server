/**
 * Self-auth module for sync server.
 *
 * 부팅 시 ES256 keypair를 생성하고 risuai의 /api/login으로 등록.
 * 등록 후 내부 요청용 JWT를 발급할 수 있다.
 *
 * @see with-sqlite/src/server/auth.ts (동일 패턴)
 */

import crypto from 'crypto';
import fs from 'fs';
import * as config from '../../config';
import * as logger from '../../logger';

const PASSWORD_PATH = `${config.RISUAI_SAVE_MOUNT}/__password`;
const JWT_LIFETIME_S = 300; // 5 minutes

let privateKey: crypto.webcrypto.CryptoKey | null = null;
let publicKeyJwk: crypto.webcrypto.JsonWebKey | null = null;
let registered = false;

/**
 * Generate ES256 keypair and register with risuai.
 * Retries until successful (risuai might not be ready yet).
 */
export async function initAuth(): Promise<void> {
  let password: string;
  try {
    password = fs.readFileSync(PASSWORD_PATH, 'utf-8').trim();
  } catch {
    logger.warn('Cannot read risuai password file — self-auth disabled', { path: PASSWORD_PATH });
    return;
  }

  if (!password) {
    logger.warn('risuai password file is empty — self-auth disabled');
    return;
  }

  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = kp.privateKey;
  publicKeyJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);

  await registerWithRetry(password);
}

async function registerWithRetry(password: string): Promise<void> {
  const maxRetries = 10;
  const retryDelay = 3000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const body = JSON.stringify({
        password,
        publicKey: publicKeyJwk,
      });

      const resp = await fetch(`${config.UPSTREAM.protocol}//${config.UPSTREAM.host}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

      if (resp.ok) {
        registered = true;
        logger.info('Self-auth registered with risuai');
        return;
      }

      const errBody = await resp.text();
      logger.warn('Self-auth registration failed', { status: String(resp.status), body: errBody, attempt: String(i + 1) });
    } catch (err) {
      logger.warn('Self-auth registration error (risuai not ready?)', {
        error: err instanceof Error ? err.message : String(err),
        attempt: String(i + 1),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  logger.error('Self-auth registration exhausted retries');
}

/**
 * Issue a JWT signed with our registered keypair.
 * Used for internal requests to risuai (e.g. database.bin fetch at startup).
 */
export async function issueInternalToken(): Promise<string | null> {
  if (!registered || !privateKey || !publicKeyJwk) return null;

  const header = { alg: 'ES256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + JWT_LIFETIME_S,
    pub: publicKeyJwk,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    Buffer.from(signingInput),
  );

  const signatureB64 = Buffer.from(signature).toString('base64url');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Check if self-auth is ready (registered with risuai).
 */
export function isAuthReady(): boolean {
  return registered;
}
