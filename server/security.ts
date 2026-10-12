import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { AppError } from './errors.js';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function constantEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, salt, hash] = encoded.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  return constantEqual((await derive(password, salt)).toString('hex'), hash);
}
export function checkOrigin(request: FastifyRequest, config: Config): void {
  const origin = request.headers.origin;
  if (!origin) return; // Non-browser clients still need a session and CSRF token for protected writes.
  const allowed = new Set([config.dashboardOrigin, config.publicBaseUrl]);
  if (config.nodeEnv !== 'production') {
    const host = request.headers.host || '';
    if (/^[a-zA-Z0-9-]+\.e2b\.app$/.test(host)) allowed.add(`https://${host}`);
    allowed.add('http://localhost:5173');
    allowed.add('http://localhost:8080');
    allowed.add('http://127.0.0.1:5173');
  }
  if (!allowed.has(origin))
    throw new AppError(
      403,
      'INVALID_ORIGIN',
      'This request originated outside your private dashboard.',
    );
}
