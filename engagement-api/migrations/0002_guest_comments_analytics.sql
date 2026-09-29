-- Upgrade the earlier draft schema without deleting comments if that draft was tested.
ALTER TABLE article_comments ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE article_comments RENAME COLUMN google_sub TO author_key;
CREATE TABLE engagement_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX engagement_sessions_expiry ON engagement_sessions(expires_at);
CREATE TABLE analytics_pages (
  page_id TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  scroll_depth INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX analytics_pages_date ON analytics_pages(created_at);
CREATE INDEX analytics_pages_session ON analytics_pages(session_hash);
CREATE TABLE analytics_clicks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES analytics_pages(page_id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX analytics_clicks_date ON analytics_clicks(created_at);
CREATE INDEX analytics_clicks_page ON analytics_clicks(page_id);
