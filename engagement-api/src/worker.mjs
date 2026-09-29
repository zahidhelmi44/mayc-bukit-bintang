import { ApiError, hash, ipKey, limit, login, requireAdmin } from './security.mjs';
import { ingest, report } from './analytics.mjs';
import articles from './articles.json' with { type: 'json' };
const known = new Set(articles);
const json = (data, status = 200) => Response.json(data, { status });
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
export function createWorker({ clock = () => Date.now() } = {}) {
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
          if (request.method === 'POST' && url.pathname === '/v1/admin/login') {
            const input = await readBody(request);
            response = json(await login(input.password, request, env, now));
          } else if (request.method === 'POST' && url.pathname === '/v1/analytics') {
            await ingest(await readBody(request), request, env, now);
            response = json({ ok: true });
          } else if (request.method === 'GET' && url.pathname === '/v1/stats') {
            const slugs = [...new Set((url.searchParams.get('slugs') || '').split(',').filter(Boolean))];
            if (!slugs.length || slugs.length > 50) throw new ApiError('Select between 1 and 50 articles.');
            slugs.forEach(slugCheck); response = json({ articles: await stats(env.DB, slugs) });
          } else if (url.pathname.startsWith('/v1/admin/')) {
            const sessionHash = await requireAdmin(request, env, now);
            if (request.method === 'POST' && url.pathname === '/v1/admin/logout') {
              await env.DB.prepare('DELETE FROM engagement_sessions WHERE token_hash = ?').bind(sessionHash).run();
              response = json({ ok: true });
            } else if (request.method === 'GET' && url.pathname === '/v1/admin/analytics') {
              response = json(await report(env.DB, Number(url.searchParams.get('days') || 30), now));
            } else if (request.method === 'GET' && url.pathname === '/v1/admin/comments') {
              const { results } = await env.DB.prepare('SELECT id, slug, author_name AS name, email, body, created_at AS createdAt FROM article_comments WHERE id < ? ORDER BY id DESC LIMIT 21').bind(cursor(url)).all();
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
                await limit(env.DB, `view:${await ipKey(request, env, now)}`, 120, 60000, now);
                const day = Math.floor(now / 86400000);
                await env.DB.prepare('INSERT OR IGNORE INTO article_views(slug, visitor_hash, day) VALUES (?, ?, ?)').bind(slug, await hash(input.visitor), day).run();
                response = json({ ...(await stats(env.DB, [slug]))[slug] });
              } else if (match[2] === 'comments' && request.method === 'GET') {
                const { results } = await env.DB.prepare('SELECT id, author_name AS name, body, created_at AS createdAt FROM article_comments WHERE slug = ? AND id < ? ORDER BY id DESC LIMIT 21').bind(slug, cursor(url)).all();
                response = json({ comments: results.slice(0, 20), next: results.length > 20 ? results[19].id : null });
              } else if (match[2] === 'comments' && request.method === 'POST') {
                const input = await readBody(request);
                const name = typeof input.name === 'string' ? input.name.trim() : '';
                const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
                if (name.length < 2 || name.length > 80 || /[\x00-\x1f]/.test(name)) throw new ApiError('Enter a display name between 2 and 80 characters.');
                if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError('Enter a valid email or leave it blank.');
                if (input.website) throw new ApiError('Unable to submit this comment.');
                const body = typeof input.body === 'string' ? input.body.trim() : '';
                if (!body || body.length > 2000) throw new ApiError('Write a comment between 1 and 2,000 characters.');
                if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new ApiError('Invalid submission.');
                const existing = await env.DB.prepare('SELECT id, slug, body, author_name, email FROM article_comments WHERE author_key = ? AND request_id = ?').bind('guest', input.requestId).first();
                if (existing && (existing.slug !== slug || existing.body !== body || existing.author_name !== name || existing.email !== email)) throw new ApiError('Submission already used. Please try again.', 409);
                if (!existing) {
                  const visitorIp = await ipKey(request, env, now);
                  await limit(env.DB, `comment-minute:${visitorIp}`, 3, 60000, now);
                  await limit(env.DB, `comment-hour:${visitorIp}`, 20, 3600000, now);
                  await env.DB.prepare('INSERT OR IGNORE INTO article_comments(slug, author_key, author_name, email, body, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(slug, 'guest', name, email, body, input.requestId, now).run();
                }
                const saved = await env.DB.prepare('SELECT id, author_name AS name, body, created_at AS createdAt FROM article_comments WHERE author_key = ? AND request_id = ?').bind('guest', input.requestId).first();
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
        env.DB.prepare('DELETE FROM engagement_limits WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM engagement_sessions WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM analytics_clicks WHERE created_at < ?').bind(now - 90 * 86400000),
        env.DB.prepare('DELETE FROM analytics_pages WHERE created_at < ?').bind(now - 90 * 86400000)
      ]);
    }
  };
}
export default createWorker();
