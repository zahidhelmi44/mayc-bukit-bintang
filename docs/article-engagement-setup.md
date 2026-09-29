# Guest comments and website engagement

Draft PR #4: https://github.com/zahidhelmi44/mayc-bukit-bintang/pull/4

## Accepted behaviour

- Reading articles, statistics and comments is public. Posting also needs no account or Google login.
- Display name is required (2–80 characters), email is optional and private, comment is required (up to 2,000 characters).
- Comments publish immediately. Names are self-provided, not authenticated identities.
- Public API responses never contain email. The password-protected admin sees the optional email and can delete comments.
- “Remember my name on this device” is opt-in and stores the display name only, never the email or comment body.
- Submitted email is for matters related to the comment; no marketing consent is collected.
- The public privacy-information page explains these behaviours.

## Website metrics

The `/admin/analitik/` dashboard and `/admin/komen/` share the same admin panel, with tabs that preserve the current in-memory session.

The dashboard supports rolling 7, 30 and 90 day reports:

| Metric | Definition |
|---|---|
| Page views | One event per page load, deduplicated by random page ID on retries. |
| Estimated unique visitors | Distinct server-keyed browser identifiers within the selected period. Not exact people. |
| Sessions | Per-tab session identifier renewed after 30 minutes of inactivity. |
| Engaged sessions | At least 10 seconds of measured active time, two page views, or one tracked click. |
| Active time | Measured while the document is visible and the window focused; background time is excluded. |
| Scroll depth | Maximum visible viewport bottom as a percentage of the document height. It does not prove comprehension. |
| Traffic source | Session entry referrer hostname, or safe allowlisted UTM labels. No full referrer URLs. |
| Campaigns | `utm_source`, `utm_medium`, `utm_campaign`; restricted characters, up to 80 characters. |
| Device | Mobile/tablet/desktop viewport category, not hardware fingerprinting. |
| Clicks | Article links, race results, WhatsApp, Instagram, native share menu, copy-link, contact, navigation and other external links. Clicking share is not proof of a completed share. |

Use labelled links to distinguish otherwise ambiguous social sources, e.g. `https://maycbukitbintang.com/artikel/we-showed-up/?utm_source=facebook&utm_medium=social&utm_campaign=metro_vol2`. Some apps omit referrers; those visits remain direct/unknown without labels.

The script runs only on public pages and skips the admin and privacy pages. It honours Do Not Track and Global Privacy Control and does not run if durable browser storage is unavailable. No visitor name, email, form contents, full referrer URLs or raw IP address is stored in the analytics tables. Analytics IDs are separate from comment records and article-view deduplication IDs. Admin activity is not measured.

Raw analytics page/click rows are retained for 90 days by a daily scheduled cleanup. Article view totals are preserved longer. Public article-view counts use a different definition: once per browser/article/UTC day, so they will not equal page views. All counts start after activation; no historical data has been invented or imported.

## Activation status

Both `enabled` and `analyticsEnabled` are **false** in `src/data/engagement.json`. The production website is unchanged. The feature needs a deployed Cloudflare Worker and D1 database; the existing static site cannot run the API itself. Google Cloud is no longer needed.

Cloudflare access from the implementation session was blocked by browser security verification. Do not activate placeholder endpoints or claim deployment complete until the real service is verified.

## Deploy the backend

Use an authenticated Cloudflare Wrangler session from the repository root:

```sh
node scripts/sync-engagement-articles.mjs
npx wrangler d1 create mayc-article-engagement
```

The owner created `mayc-article-engagement` in the dashboard and supplied database ID `731f2efe-9a71-4afa-886d-877a0f7b1b2b` on 29 September 2026. This ID is now configured in `engagement-api/wrangler.jsonc`; do not create a duplicate database for this deployment. Keep `ALLOWED_ORIGINS` restricted to the real site. If using a controlled staging site, authorize that exact origin separately.

For the existing Cloudflare Workers Builds project, use branch `feature/article-google-comments`, root `/`, and build command `node scripts/sync-engagement-articles.mjs`. Set the deploy command to apply pending migrations before publishing the Worker:

```sh
npx wrangler d1 migrations apply DB --remote --config engagement-api/wrangler.jsonc && npx wrangler deploy --config engagement-api/wrangler.jsonc
```

The build token needs access to this D1 database as well as Worker deployment. If the build reports a permissions error, update its D1 permissions before retrying. Database configuration alone does not confirm that migrations, secrets or deployment have completed.

```sh
npx wrangler d1 migrations apply DB --remote --config engagement-api/wrangler.jsonc
npx wrangler deploy --config engagement-api/wrangler.jsonc
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put RATE_LIMIT_SALT --config engagement-api/wrangler.jsonc
```

Set a new dedicated admin password with the hidden prompt helper, piping the resulting salted hash directly into a Worker secret:

```sh
node scripts/admin-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH --config engagement-api/wrangler.jsonc
```

Use a unique password of at least 16 characters. Neither the password nor its hash belongs in the frontend or GitHub source. Only the owner should enter the new password. Authentication uses a short-lived opaque bearer session token held in memory, never browser persistent storage. Logging out revokes the server session; rotating the hash invalidates all old sessions. Rate limiting applies to sign-in and guest comments. An unconfigured admin cannot sign in.

The second migration upgrades the earlier un-deployed Google draft schema without deleting existing test comments. It renames the legacy author key column; all new posts use the guest namespace. There is no active Google dependency.

## Connect the static website

After the API is deployed, set:

```json
{
  "enabled": true,
  "analyticsEnabled": true,
  "apiBase": "https://YOUR-REAL-WORKER.workers.dev"
}
```

Set only the flags for the services intended to go live. The build rejects an invalid API origin. Run:

```sh
npm run test:engagement
npm run build
```

Publish through the existing website deployment after verifying the real API. The owner can then use `/admin/analitik/` for analytics and `/admin/komen/` for comments; the tabs switch without needing a second login.

## Final live checks

1. Anonymous readers can open articles, read comments and post with only a name and comment.
2. Optional email is absent from public responses and appears only after admin authentication.
3. A repeated submission does not add a duplicate comment; repeated article refreshes do not increase its daily browser view count.
4. Admin login works; wrong password and missing/expired token fail; deleting a comment updates the public list and count.
5. Visit a labelled test URL, scroll and click a share link. Check source, page, scroll and click reports; private form values must not appear in analytics.
6. Check the real mobile and desktop layouts. Counts will under-report users with blockers or opt-outs.

The tests use real SQLite migrations and real admin password/session verification. Production Cloudflare deployment and visual browser checks remain outstanding because the service was inaccessible from the agent browser.

When adding a new article slug, run `npm run engagement:sync` and redeploy the Worker along with publishing the article. Its generated allowlist prevents arbitrary analytics paths and comment targets.

References:
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
