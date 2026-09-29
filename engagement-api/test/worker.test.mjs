import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../src/worker.mjs';
import { ApiError } from '../src/google.mjs';
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8'));
  function prepare(query, values = []) {
    return { bind(...args) { return prepare(query, args); }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return sql.prepare(query).run(...values); } };
  }
  const DB = { prepare, async batch(stmts) { sql.exec('BEGIN'); try { const results = []; for (const s of stmts) results.push(await s.all()); sql.exec('COMMIT'); return results; } catch (e) { sql.exec('ROLLBACK'); throw e; } } };
  let now = Date.now();
  const env = { DB, GOOGLE_CLIENT_ID: 'test-client', ADMIN_GOOGLE_SUBS: '999', ALLOWED_ORIGINS: 'https://maycbukitbintang.com', RATE_LIMIT_SALT: 'test-only-salt' };
  const app = createWorker({ clock: () => now, verify: async token => { if (!['member', 'admin'].includes(token)) throw new ApiError('Invalid token', 401); return { sub: token === 'admin' ? '999' : '123', name: token === 'admin' ? 'Admin' : 'Google Profile Name' }; } });
  async function request(path, { method = 'GET', token, body, origin = 'https://maycbukitbintang.com' } = {}) {
    const headers = { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const response = await app.fetch(new Request(`https://api.example.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
    const data = response.status === 204 ? null : await response.json(); return { response, data };
  }
  return { app, env, sql, request, advance: ms => now += ms };
}
const article = '/v1/articles/we-showed-up';
const post = (body = 'Hello community', requestId = crypto.randomUUID()) => ({ body, requestId, name: 'Forged Admin', google_sub: '999' });
test('public reading and views never require Google login; refreshes do not inflate daily count', async () => {
  const s = setup();
  assert.equal((await s.request(article + '/comments', { origin: null })).response.status, 200);
  assert.equal((await s.request('/v1/stats?slugs=we-showed-up')).response.status, 200);
  const visitor = crypto.randomUUID();
  for (let i = 0; i < 5; i++) assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor } })).data.views, 1);
  assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor: crypto.randomUUID() } })).data.views, 2);
  s.advance(86400000);
  assert.equal((await s.request(article + '/views', { method: 'POST', body: { visitor } })).data.views, 3);
  s.advance(4 * 86400000); await s.app.scheduled({}, s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM article_views').get().n, 0);
  assert.equal((await s.request('/v1/stats?slugs=we-showed-up')).data.articles['we-showed-up'].views, 3);
});
test('comments require Google and publish immediately with the verified profile name, without exposing account IDs', async () => {
  const s = setup();
  assert.equal((await s.request(article + '/comments', { method: 'POST', body: post() })).response.status, 401);
  assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'forged', body: post() })).response.status, 401);
  const body = post('<img src=x onerror=alert(1)>');
  const result = await s.request(article + '/comments', { method: 'POST', token: 'member', body });
  assert.equal(result.response.status, 201); assert.equal(result.data.comment.name, 'Google Profile Name');
  const publicList = (await s.request(article + '/comments')).data.comments;
  assert.equal(publicList.length, 1); assert.equal(publicList[0].body, body.body);
  assert.deepEqual(Object.keys(publicList[0]).sort(), ['body', 'createdAt', 'id', 'name']);
  assert.equal(result.data.comments, 1);
  const retry = await s.request(article + '/comments', { method: 'POST', token: 'member', body });
  assert.equal(retry.response.status, 200); assert.equal(retry.data.comments, 1);
  assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'member', body: { ...body, body: 'different' } })).response.status, 409);
});
test('only configured admin can read moderation list and delete; count updates after deletion', async () => {
  const s = setup();
  const saved = await s.request(article + '/comments', { method: 'POST', token: 'member', body: post() });
  const path = `/v1/admin/comments/${saved.data.comment.id}`;
  assert.equal((await s.request('/v1/admin/comments')).response.status, 401);
  assert.equal((await s.request('/v1/admin/comments', { token: 'member' })).response.status, 403);
  assert.equal((await s.request(path, { method: 'DELETE', token: 'member' })).response.status, 403);
  assert.equal((await s.request(path, { method: 'DELETE', token: 'admin', origin: 'https://evil.test' })).response.status, 403);
  assert.equal((await s.request('/v1/admin/comments', { token: 'admin' })).data.comments.length, 1);
  assert.equal((await s.request(path, { method: 'DELETE', token: 'admin' })).response.status, 200);
  assert.equal((await s.request(article + '/comments')).data.comments.length, 0);
  assert.equal((await s.request('/v1/stats?slugs=we-showed-up')).data.articles['we-showed-up'].comments, 0);
});
test('bad origins, unknown articles, overlong comments and repeated spam are rejected', async () => {
  const s = setup();
  assert.equal((await s.request('/v1/stats?slugs=not-a-real-article')).response.status, 404);
  assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'member', body: post('a'.repeat(2001)) })).response.status, 400);
  assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'member', origin: null, body: post() })).response.status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'member', body: post() })).response.status, 201);
  assert.equal((await s.request(article + '/comments', { method: 'POST', token: 'member', body: post() })).response.status, 429);
});
test('public pagination uses descending IDs without repeats', async () => {
  const s = setup(); const insert = s.sql.prepare('INSERT INTO article_comments(slug, google_sub, author_name, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 24; i++) insert.run('we-showed-up', '123', 'Reader', `Comment ${i}`, crypto.randomUUID(), Date.now());
  const first = (await s.request(article + '/comments')).data;
  assert.equal(first.comments.length, 20); assert.equal(first.next, 5);
  const second = (await s.request(article + `/comments?before=${first.next}`)).data;
  assert.equal(second.comments.length, 4); assert.equal(second.next, null);
  assert.equal(new Set([...first.comments, ...second.comments].map(c => c.id)).size, 24);
});
