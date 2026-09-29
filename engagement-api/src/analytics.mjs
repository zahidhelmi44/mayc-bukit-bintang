import { ApiError, keyedHash, ipKey, limit } from './security.mjs';
import articles from './articles.json' with { type: 'json' };
const paths = new Set(['/', '/artikel/', '/sejarah/', ...articles.map(slug => `/artikel/${slug}/`)]);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const actions = new Set(['article_open', 'race_results', 'whatsapp', 'instagram', 'share_menu', 'copy_link', 'contact_email', 'contact_phone', 'external_link', 'navigation']);
const campaign = value => typeof value === 'string' && /^[a-zA-Z0-9_. -]{0,80}$/.test(value) ? value : '';
export async function ingest(input, request, env, now) {
  if (!uuid(input.pageId) || !uuid(input.visitor) || !uuid(input.session)) throw new ApiError('Invalid analytics identifier.');
  if (!['page_view', 'engagement', 'click'].includes(input.type)) throw new ApiError('Invalid analytics event.');
  const visitor = await keyedHash(env.RATE_LIMIT_SALT, 'analytics-visitor', input.visitor);
  const session = await keyedHash(env.RATE_LIMIT_SALT, 'analytics-session', input.session);
  await limit(env.DB, `analytics:${await ipKey(request, env, now)}`, 300, 60000, now);
  if (input.type === 'page_view') {
    if (!paths.has(input.path) || !['mobile', 'tablet', 'desktop'].includes(input.device)) throw new ApiError('Invalid analytics page.');
    const referrer = typeof input.referrer === 'string' && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(input.referrer) && input.referrer.length <= 253 ? input.referrer : '';
    await env.DB.prepare('INSERT OR IGNORE INTO analytics_pages(page_id, visitor_hash, session_hash, path, referrer, utm_source, utm_medium, utm_campaign, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(input.pageId, visitor, session, input.path, referrer, campaign(input.utmSource), campaign(input.utmMedium), campaign(input.utmCampaign), input.device, now).run();
    return;
  }
  const page = await env.DB.prepare('SELECT created_at FROM analytics_pages WHERE page_id = ? AND visitor_hash = ? AND session_hash = ?').bind(input.pageId, visitor, session).first();
  if (!page) throw new ApiError('Start a page view first.', 409);
  if (input.type === 'engagement') {
    if (!Number.isFinite(input.activeMs) || !Number.isFinite(input.scrollDepth)) throw new ApiError('Invalid engagement.');
    const activeMs = Math.min(Math.max(0, Math.floor(input.activeMs)), now - page.created_at, 43200000);
    const depth = Math.min(100, Math.max(0, Math.floor(input.scrollDepth)));
    await env.DB.prepare('UPDATE analytics_pages SET active_ms = MAX(active_ms, ?), scroll_depth = MAX(scroll_depth, ?) WHERE page_id = ?').bind(activeMs, depth, input.pageId).run();
  } else {
    if (!uuid(input.id) || !actions.has(input.action)) throw new ApiError('Invalid interaction.');
    const target = paths.has(input.target) ? input.target : '';
    await env.DB.prepare('INSERT OR IGNORE INTO analytics_clicks(id, page_id, action, target, created_at) VALUES (?, ?, ?, ?, ?)').bind(input.id, input.pageId, input.action, target, now).run();
  }
}
export async function report(db, days, now) {
  if (![7, 30, 90].includes(days)) throw new ApiError('Choose 7, 30 or 90 days.');
  const since = now - days * 86400000;
  const queries = [
    db.prepare('SELECT COUNT(*) AS pageViews, COUNT(DISTINCT visitor_hash) AS visitors, COUNT(DISTINCT session_hash) AS sessions, COALESCE(SUM(active_ms),0) AS activeMs FROM analytics_pages WHERE created_at >= ?').bind(since),
    db.prepare('SELECT COUNT(*) AS engagedSessions FROM (SELECT session_hash FROM analytics_pages WHERE created_at >= ? GROUP BY session_hash HAVING SUM(active_ms) >= 10000 OR COUNT(*) >= 2 OR MAX(EXISTS(SELECT 1 FROM analytics_clicks c WHERE c.page_id = analytics_pages.page_id)) = 1)').bind(since),
    db.prepare('SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors, ROUND(AVG(active_ms)/1000.0,1) AS averageSeconds, ROUND(AVG(scroll_depth),1) AS averageScroll, SUM(scroll_depth >= 90) AS deepReads FROM analytics_pages WHERE created_at >= ? GROUP BY path ORDER BY views DESC LIMIT 30').bind(since),
    db.prepare("SELECT CASE WHEN utm_source <> '' THEN utm_source WHEN referrer <> '' THEN referrer ELSE 'Direct / unknown' END AS source, COUNT(DISTINCT session_hash) AS sessions FROM analytics_pages WHERE created_at >= ? GROUP BY source ORDER BY sessions DESC LIMIT 30").bind(since),
    db.prepare("SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(DISTINCT session_hash) AS sessions FROM analytics_pages WHERE created_at >= ? AND (utm_source <> '' OR utm_medium <> '' OR utm_campaign <> '') GROUP BY utm_source, utm_medium, utm_campaign ORDER BY sessions DESC LIMIT 30").bind(since),
    db.prepare('SELECT device, COUNT(*) AS views FROM analytics_pages WHERE created_at >= ? GROUP BY device ORDER BY views DESC').bind(since),
    db.prepare('SELECT action, target, COUNT(*) AS clicks FROM analytics_clicks WHERE created_at >= ? GROUP BY action, target ORDER BY clicks DESC LIMIT 30').bind(since),
    db.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', '+8 hours') AS date, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors FROM analytics_pages WHERE created_at >= ? GROUP BY date ORDER BY date").bind(since)
  ];
  const rows = await db.batch(queries);
  const summary = { ...rows[0].results[0], ...rows[1].results[0] };
  summary.engagementRate = summary.sessions ? Math.round(summary.engagedSessions / summary.sessions * 1000) / 10 : 0;
  summary.averageSeconds = summary.pageViews ? Math.round(summary.activeMs / summary.pageViews / 100) / 10 : 0;
  return { days, since, generatedAt: now, summary, pages: rows[2].results, sources: rows[3].results, campaigns: rows[4].results, devices: rows[5].results, clicks: rows[6].results, daily: rows[7].results };
}
