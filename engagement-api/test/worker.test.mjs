import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../src/worker.mjs';
import { passwordHash } from '../src/security.mjs';
const password = 'test-admin-password-2026';
const adminHash = await passwordHash(password);
function setup() {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'));
  function prepare(query, values = []) {
    return { bind(...args) { return prepare(query, args); }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return sql.prepare(query).run(...values); } };
  }
  const DB = { prepare, async batch(stmts) { sql.exec('BEGIN'); try { const results = []; for (const s of stmts) results.push(await s.all()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
  let now = Date.now();
  const env = { DB, ADMIN_PASSWORD_HASH: adminHash, ALLOWED_ORIGINS: 'https://maycbukitbintang.com', RATE_LIMIT_SALT: 'test-only-salt' };
  const app = createWorker({ clock: () => now });
  async function request(path, { method = 'GET', token, body, origin = 'https://maycbukitbintang.com' } = {}) {
    const headers = { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const response = await app.fetch(new Request(`https://api.example.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
    const data = response.status === 204 ? null : await response.json(); return { response, data };
  }
  const admin = async () => (await request('/v1/admin/login', { method: 'POST', body: { password } })).data.token;
  return { app, env, sql, request, admin, advance: ms => now += ms };
}
const article = '/v1/articles/we-showed-up';
const post = (overrides = {}) => ({ name: 'Reader Name', email: 'reader@example.com', body: 'Hello community', requestId: crypto.randomUUID(), ...overrides });
test('public reading and views do not require login; refreshes count once per browser/day', async () => {
  const s = setup();
  assert.equal((await s.request(article + '/comments', { origin: null })).response.status, 200);
  const visitor = crypto.randomUUID();
  for (let i = 0; i < 5; i++) assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor } })).data.views, 1);
  assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor: crypto.randomUUID() } })).data.views, 2);
  s.advance(86400000); assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor } })).data.views, 3);
  s.advance(4 * 86400000); await s.app.scheduled({}, s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM article_views').get().n, 0);
  assert.equal((await s.request('/v1/stats?slugs=we-showed-up')).data.articles['we-showed-up'].views, 3);
});
test('guest comments publish immediately; public responses never reveal optional email; retries do not duplicate', async () => {
  const s = setup(); const body = post({ body: '<img src=x onerror=alert(1)>' });
  const result = await s.request(article + '/comments', { method: 'POST', body });
  assert.equal(result.response.status, 201); assert.equal(result.data.comment.name, 'Reader Name');
  assert.deepEqual(Object.keys(result.data.comment).sort(), ['body', 'createdAt', 'id', 'name']);
  const publicList = (await s.request(article + '/comments')).data.comments;
  assert.equal(publicList.length, 1); assert.equal(publicList[0].body, body.body);
  assert.deepEqual(Object.keys(publicList[0]).sort(), ['body', 'createdAt', 'id', 'name']);
  assert.ok(!JSON.stringify(publicList).includes('reader@example.com'));
  const retry = await s.request(article + '/comments', { method: 'POST', body });
  assert.equal(retry.response.status, 200); assert.equal(retry.data.comments, 1);
  assert.equal((await s.request(article + '/comments', { method: 'POST', body: { ...body, email: 'other@example.com' } })).response.status, 409);
  assert.equal((await s.request(article + '/comments', { method: 'POST', body: post({ email: '' }) })).response.status, 201);
});
test('only password-authenticated admin can read private email or delete; logout and expiry revoke access', async () => {
  const s = setup(); const saved = await s.request(article + '/comments', { method: 'POST', body: post() });
  const path = `/v1/admin/comments/${saved.data.comment.id}`;
  assert.equal((await s.request('/v1/admin/comments')).response.status, 401);
  assert.equal((await s.request(path, { method: 'DELETE', token: 'f'.repeat(64) })).response.status, 401);
  assert.equal((await s.request('/v1/admin/login', { method: 'POST', body: { password: 'wrong' } })).response.status, 401);
  const token = await s.admin(); assert.equal(token.length, 64);
  assert.equal((await s.request('/v1/admin/comments', { token })).data.comments[0].email, 'reader@example.com');
  assert.equal((await s.request(path, { method: 'DELETE', token, origin: 'https://evil.test' })).response.status, 403);
  assert.equal((await s.request(path, { method: 'DELETE', token })).response.status, 200);
  assert.equal((await s.request('/v1/stats?slugs=we-showed-up')).data.articles['we-showed-up'].comments, 0);
  await s.request('/v1/admin/logout', { method: 'POST', token });
  assert.equal((await s.request('/v1/admin/comments', { token })).response.status, 401);
  const expired = await s.admin(); s.advance(3600001);
  assert.equal((await s.request('/v1/admin/comments', { token: expired })).response.status, 401);
});
test('name/email validation, honeypot, origins and comment spam limits are enforced', async () => {
  const s = setup();
  for (const body of [post({ name: '' }), post({ email: 'invalid' }), post({ body: 'a'.repeat(2001) }), post({ website: 'spam.test' })]) assert.equal((await s.request(article + '/comments', { method: 'POST', body })).response.status, 400);
  assert.equal((await s.request('/v1/stats?slugs=not-a-real-article')).response.status, 404);
  assert.equal((await s.request(article + '/comments', { method: 'POST', origin: null, body: post() })).response.status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await s.request(article + '/comments', { method: 'POST', body: post() })).response.status, 201);
  assert.equal((await s.request(article + '/comments', { method: 'POST', body: post() })).response.status, 429);
});
test('public pagination has no repeats or private email fields', async () => {
  const s = setup(); const insert = s.sql.prepare('INSERT INTO article_comments(slug, author_key, author_name, email, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 24; i++) insert.run('we-showed-up', 'guest', 'Reader', 'private@example.com', `Comment ${i}`, crypto.randomUUID(), Date.now());
  const first = (await s.request(article + '/comments')).data;
  assert.equal(first.comments.length, 20); assert.equal(first.next, 5);
  const second = (await s.request(article + `/comments?before=${first.next}`)).data;
  assert.equal(second.comments.length, 4); assert.equal(second.next, null);
  assert.equal(new Set([...first.comments, ...second.comments].map(c => c.id)).size, 24);
  assert.ok(!JSON.stringify([first, second]).includes('private@example.com'));
});
test('analytics deduplicates events, bounds active time, counts sessions and requires admin for all reports', async () => {
  const s = setup(); const page = { pageId: crypto.randomUUID(), visitor: crypto.randomUUID(), session: crypto.randomUUID(), type: 'page_view', path: '/artikel/we-showed-up/', referrer: 'facebook.com', utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'metro_vol2', device: 'mobile', email: 'MUST-NOT-BE-SAVED@example.com' };
  const send = body => s.request('/v1/analytics', { method: 'POST', body });
  for (let i = 0; i < 3; i++) assert.equal((await send(page)).response.status, 200);
  s.advance(20000);
  const engagement = { ...page, type: 'engagement', activeMs: 15000, scrollDepth: 95 };
  await send(engagement); await send(engagement);
  const click = { ...page, type: 'click', id: crypto.randomUUID(), action: 'whatsapp' };
  await send(click); await send(click);
  assert.equal((await s.request('/v1/admin/analytics?days=7')).response.status, 401);
  const token = await s.admin();
  let data = (await s.request('/v1/admin/analytics?days=7', { token })).data;
  assert.equal(data.summary.pageViews, 1); assert.equal(data.summary.visitors, 1); assert.equal(data.summary.sessions, 1);
  assert.equal(data.summary.activeMs, 15000); assert.equal(data.summary.engagementRate, 100); assert.equal(data.pages[0].deepReads, 1);
  assert.equal(data.clicks[0].clicks, 1); assert.equal(data.sources[0].source, 'facebook');
  await send({ ...page, pageId: crypto.randomUUID(), path: '/' });
  data = (await s.request('/v1/admin/analytics?days=7', { token })).data;
  assert.equal(data.summary.pageViews, 2); assert.equal(data.summary.visitors, 1); assert.equal(data.summary.sessions, 1);
  assert.equal(data.summary.averageSeconds, 7.5);
  const stored = JSON.stringify(s.sql.prepare('SELECT * FROM analytics_pages').all());
  assert.ok(!stored.includes('MUST-NOT-BE-SAVED')); assert.ok(!stored.includes(page.visitor));
  assert.equal((await send({ ...page, pageId: crypto.randomUUID(), path: '/admin/komen/' })).response.status, 400);
  assert.equal((await send({ ...engagement, visitor: crypto.randomUUID() })).response.status, 409);
  assert.equal((await s.request('/v1/admin/analytics?days=999', { token })).response.status, 400);
  s.advance(91 * 86400000); await s.app.scheduled({}, s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM analytics_pages').get().n, 0);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM analytics_clicks').get().n, 0);
});
test('unconfigured and rate-limited admin login fail closed, and password rotation invalidates sessions', async () => {
  const s = setup(); const token = await s.admin();
  s.env.ADMIN_PASSWORD_HASH = await passwordHash('a-different-admin-password');
  assert.equal((await s.request('/v1/admin/comments', { token })).response.status, 401);
  for (let i = 0; i < 7; i++) assert.equal((await s.request('/v1/admin/login', { method: 'POST', body: { password: 'wrong' } })).response.status, 401);
  assert.equal((await s.request('/v1/admin/login', { method: 'POST', body: { password: 'wrong' } })).response.status, 429);
  const other = setup(); other.env.ADMIN_PASSWORD_HASH = '';
  assert.equal((await other.request('/v1/admin/login', { method: 'POST', body: { password } })).response.status, 503);
});
