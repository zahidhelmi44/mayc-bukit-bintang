import { ApiError, verifyGoogleToken } from './google.mjs';
import articles from './articles.json' with { type: 'json' };
const known = new Set(articles);
const json = (data, status = 200) => Response.json(data, { status });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
const isAdmin = (user, env) => String(env.ADMIN_GOOGLE_SUBS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user.sub);
const slugCheck = slug => { if (!known.has(slug)) throw new ApiError('Article not found.', 404); return slug; };
async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('Use JSON.', 415);
  if (!request.body) throw new ApiError('Empty request.');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 8192) { await reader.cancel(); throw new ApiError('Comment is too large.', 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(data)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError('Invalid JSON.'); }
}
async function limit(db, key, max, window, now) {
  const bucket = `${key}:${Math.floor(now / window)}`;
  const row = await db.prepare('INSERT INTO engagement_limits(bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts').bind(bucket, now + window).first();
  if (row.attempts > max) throw new ApiError('Too many requests. Please wait a moment and try again.', 429);
}
async function stats(db, slugs) {
  const marks = slugs.map(() => '?').join(',');
  const [views, comments] = await db.batch([
    db.prepare(`SELECT slug, views FROM article_counts WHERE slug IN (${marks})`).bind(...slugs),
    db.prepare(`SELECT slug, COUNT(*) AS comments FROM article_comments WHERE slug IN (${marks}) GROUP BY slug`).bind(...slugs)
  ]);
  return Object.fromEntries(slugs.map(slug => [slug, { views: views.results.find(r => r.slug === slug)?.views || 0, comments: comments.results.find(r => r.slug === slug)?.comments || 0 }]));
}
function cursor(url) {
  const value = url.searchParams.get('before');
  if (value === null) return Number.MAX_SAFE_INTEGER;
  if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError('Invalid comment page.');
  return Number(value);
}
export function createWorker({ verify = verifyGoogleToken, clock = () => Date.now() } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url); const origin = request.headers.get('Origin');
      const origins = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
      let response;
      try {
        if (origin && !origins.includes(origin)) throw new ApiError('This origin is not allowed.', 403);
        if (request.method === 'OPTIONS') {
          if (!origin || !origins.includes(origin)) throw new ApiError('This origin is not allowed.', 403);
          response = new Response(null, { status: 204 });
        } else {
          if (!env.DB) throw new ApiError('Comments are not connected yet.', 503);
          if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new ApiError('Method not allowed.', 405);
          if (request.method !== 'GET' && !origin) throw new ApiError('An allowed origin is required.', 403);
          const now = clock();
          const identify = async () => {
            const auth = request.headers.get('Authorization') || '';
            if (!auth.startsWith('Bearer ')) throw new ApiError('Please sign in with Google to comment.', 401);
            return verify(auth.slice(7), env.GOOGLE_CLIENT_ID);
          };
          if (request.method === 'GET' && url.pathname === '/v1/me') {
            const user = await identify(); response = json({ name: user.name, accountId: user.sub, isAdmin: isAdmin(user, env) });
          } else if (request.method === 'GET' && url.pathname === '/v1/stats') {
            const slugs = [...new Set((url.searchParams.get('slugs') || '').split(',').filter(Boolean))];
            if (!slugs.length || slugs.length > 50) throw new ApiError('Select between 1 and 50 articles.');
            slugs.forEach(slugCheck); response = json({ articles: await stats(env.DB, slugs) });
          } else if (url.pathname.startsWith('/v1/admin/')) {
            const user = await identify(); if (!isAdmin(user, env)) throw new ApiError('Only the site admin can manage comments.', 403);
            if (request.method === 'GET' && url.pathname === '/v1/admin/comments') {
              const { results } = await env.DB.prepare('SELECT id, slug, author_name AS name, body, created_at AS createdAt FROM article_comments WHERE id < ? ORDER BY id DESC LIMIT 21').bind(cursor(url)).all();
              response = json({ comments: results.slice(0, 20), next: results.length > 20 ? results[19].id : null });
            } else if (request.method === 'DELETE' && /^\/v1\/admin\/comments\/[1-9][0-9]*$/.test(url.pathname)) {
              const id = Number(url.pathname.split('/').pop()); if (!Number.isSafeInteger(id)) throw new ApiError('Invalid comment.');
              const result = await env.DB.prepare('DELETE FROM article_comments WHERE id = ? RETURNING id').bind(id).first();
              if (!result) throw new ApiError('Comment already removed or not found.', 404);
              response = json({ ok: true });
            }
          } else {
            const match = url.pathname.match(/^\/v1\/articles\/([a-z0-9-]+)\/(views|comments)$/);
            if (match) {
              const slug = slugCheck(match[1]);
              if (match[2] === 'views' && request.method === 'POST') {
                const input = await readBody(request);
                if (typeof input.visitor !== 'string' || !/^[a-f0-9-]{36}$/.test(input.visitor)) throw new ApiError('Invalid visit.');
                if (!env.RATE_LIMIT_SALT) throw new ApiError('Views are not configured yet.', 503);
                const ip = request.headers.get('CF-Connecting-IP') || 'local';
                const ipKey = await hash(`${env.RATE_LIMIT_SALT}:${Math.floor(now / 86400000)}:${ip}`);
                await limit(env.DB, `view:${ipKey}`, 120, 60000, now);
                const day = Math.floor(now / 86400000);
                await env.DB.prepare('INSERT OR IGNORE INTO article_views(slug, visitor_hash, day) VALUES (?, ?, ?)').bind(slug, await hash(input.visitor), day).run();
                response = json({ ...(await stats(env.DB, [slug]))[slug] });
              } else if (match[2] === 'comments' && request.method === 'GET') {
                const { results } = await env.DB.prepare('SELECT id, author_name AS name, body, created_at AS createdAt FROM article_comments WHERE slug = ? AND id < ? ORDER BY id DESC LIMIT 21').bind(slug, cursor(url)).all();
                response = json({ comments: results.slice(0, 20), next: results.length > 20 ? results[19].id : null });
              } else if (match[2] === 'comments' && request.method === 'POST') {
                const user = await identify(); const input = await readBody(request);
                const body = typeof input.body === 'string' ? input.body.trim() : '';
                if (!body || body.length > 2000) throw new ApiError('Write a comment between 1 and 2,000 characters.');
                if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new ApiError('Invalid submission.');
                const existing = await env.DB.prepare('SELECT id, slug, body FROM article_comments WHERE google_sub = ? AND request_id = ?').bind(user.sub, input.requestId).first();
                if (existing && (existing.slug !== slug || existing.body !== body)) throw new ApiError('Submission already used. Please try again.', 409);
                if (!existing) {
                  await limit(env.DB, `comment-minute:${user.sub}`, 3, 60000, now);
                  await limit(env.DB, `comment-hour:${user.sub}`, 20, 3600000, now);
                  await env.DB.prepare('INSERT OR IGNORE INTO article_comments(slug, google_sub, author_name, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(slug, user.sub, user.name, body, input.requestId, now).run();
                }
                const saved = await env.DB.prepare('SELECT id, author_name AS name, body, created_at AS createdAt FROM article_comments WHERE google_sub = ? AND request_id = ?').bind(user.sub, input.requestId).first();
                response = json({ comment: saved, ...(await stats(env.DB, [slug]))[slug] }, existing ? 200 : 201);
              }
            }
          }
          if (!response) throw new ApiError('Not found.', 404);
        }
      } catch (error) {
        if (!(error instanceof ApiError)) console.error('Engagement request failed:', error.name);
        response = json({ error: error instanceof ApiError ? error.message : 'The service is temporarily unavailable. Please retry.' }, error instanceof ApiError ? error.status : 500);
      }
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Vary', 'Origin');
      if (origin && origins.includes(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        headers.set('Access-Control-Max-Age', '600');
      }
      return new Response(response.body, { status: response.status, headers });
    },
    async scheduled(_event, env) {
      const now = clock();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM article_views WHERE day < ?').bind(Math.floor(now / 86400000) - 2),
        env.DB.prepare('DELETE FROM engagement_limits WHERE expires_at < ?').bind(now)
      ]);
    }
  };
}
export default createWorker();
