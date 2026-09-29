import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoogleToken } from '../src/google.mjs';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey); jwk.kid = 'test-key';
const now = Date.now();
const claims = { iss: 'https://accounts.google.com', aud: 'our-client', sub: '123456', iat: now / 1000 - 10, exp: now / 1000 + 3600, email_verified: true, name: 'Real Profile' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function sign(overrides = {}, header = {}) {
  const body = `${encode({ alg: 'RS256', kid: 'test-key', ...header })}.${encode({ ...claims, ...overrides })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(signature).toString('base64url')}`;
}
const options = { now, fetcher: async () => Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'public, max-age=3600' } }) };
test('Google JWT requires valid signature, audience, issuer, lifetime, verified account and RS256', async () => {
  assert.deepEqual(await verifyGoogleToken(await sign(), 'our-client', options), { sub: '123456', name: 'Real Profile' });
  for (const wrong of [{ aud: 'other-client' }, { azp: 'other-client' }, { iss: 'https://evil.test' }, { exp: now / 1000 - 1 }, { iat: now / 1000 + 10000 }, { email_verified: false }, { sub: '' }]) {
    await assert.rejects(verifyGoogleToken(await sign(wrong), 'our-client', options), error => error.status === 401);
  }
  await assert.rejects(verifyGoogleToken(await sign({}, { alg: 'none' }), 'our-client', options), error => error.status === 401);
  const valid = await sign(); const parts = valid.split('.'); parts[1] = encode({ ...claims, sub: '999' });
  await assert.rejects(verifyGoogleToken(parts.join('.'), 'our-client', options), error => error.status === 401);
  await assert.rejects(verifyGoogleToken(valid, '', options), error => error.status === 503);
});
