export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const encoder = new TextEncoder();
export const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
export const hash = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
export async function keyedHash(secret, purpose, text) {
  if (!secret) throw new ApiError('The service is not configured yet.', 503);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}:${text}`)));
}
export async function passwordHash(password, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = Uint8Array.from(salt.match(/../g), x => parseInt(x, 16));
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: 100000 }, key, 256);
  return `pbkdf2:100000:${salt}:${hex(result)}`;
}
export async function limit(db, key, max, window, now) {
  const bucket = `${key}:${Math.floor(now / window)}`;
  const row = await db.prepare('INSERT INTO engagement_limits(bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(bucket, now + window).first();
  if (row.attempts > max) throw new ApiError('Too many requests. Please wait a moment and try again.', 429);
}
export async function ipKey(request, env, now) {
  return keyedHash(env.RATE_LIMIT_SALT, `ip:${Math.floor(now / 86400000)}`, request.headers.get('CF-Connecting-IP') || 'local');
}
export async function login(password, request, env, now) {
  await limit(env.DB, `login:${await ipKey(request, env, now)}`, 8, 900000, now);
  const expected = env.ADMIN_PASSWORD_HASH || '';
  if (!/^pbkdf2:100000:[a-f0-9]{32}:[a-f0-9]{64}$/.test(expected)) throw new ApiError('Admin access is not configured yet.', 503);
  if (typeof password !== 'string' || password.length > 256) throw new ApiError('Incorrect password.', 401);
  const actual = await passwordHash(password, expected.split(':')[2]);
  let difference = actual.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference !== 0) throw new ApiError('Incorrect password.', 401);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO engagement_sessions(token_hash, expires_at) VALUES (?, ?)').bind(await hash(`${token}:${expected}`), now + 3600000).run();
  return { token, expiresAt: now + 3600000 };
}
export async function requireAdmin(request, env, now) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ApiError('Please sign in as admin.', 401);
  const tokenHash = await hash(`${token}:${env.ADMIN_PASSWORD_HASH}`);
  const session = await env.DB.prepare('SELECT expires_at FROM engagement_sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session || session.expires_at <= now) throw new ApiError('Admin session expired. Please sign in again.', 401);
  return tokenHash;
}
