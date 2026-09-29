CREATE TABLE article_counts (
  slug TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0)
);
CREATE TABLE article_views (
  slug TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (slug, visitor_hash, day)
);
CREATE INDEX article_views_day ON article_views(day);
CREATE TRIGGER count_article_view AFTER INSERT ON article_views BEGIN
  INSERT INTO article_counts(slug, views) VALUES (NEW.slug, 1)
  ON CONFLICT(slug) DO UPDATE SET views = views + 1;
END;
CREATE TABLE article_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(google_sub, request_id)
);
CREATE INDEX article_comments_slug_id ON article_comments(slug, id DESC);
CREATE TABLE engagement_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX engagement_limits_expiry ON engagement_limits(expires_at);
