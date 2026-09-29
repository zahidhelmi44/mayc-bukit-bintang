# Article views and Google comments

Implementation branch: `feature/article-google-comments`.

## Behaviour

- Articles, comment lists and view counts remain public. Google loads only after the visitor clicks sign in to comment.
- Only posting a comment requires Google authentication. A verified Google ID token supplies the displayed profile name; a manually submitted name is ignored.
- Comments appear immediately. No approval queue.
- The allowlisted admin can delete comments at `/admin/komen/` or from an article after signing in. Other accounts cannot delete.
- Email addresses and Google account IDs never appear in public comment responses. Names are Google profile names, not independently verified legal names.
- The ID token stays in memory. The browser stores only an anonymous random visit identifier, used to avoid counting refreshes as new daily views.
- Views count once per browser/article/UTC day. They are not exact unique people and start at zero when enabled. Private windows, clearing storage and other devices can be counted separately. Bots are rate-limited, not perfectly excluded.
- API counts are shared across devices. No client-side fake totals. A unavailable API displays a dash, not a misleading zero.

## Current activation state

`src/data/engagement.json` has `enabled: false`. Do not enable it until the real Worker, D1 database, Google web client and admin allowlist are configured and the live sign-in flow has been checked. The existing static site does not itself run this Worker.

## Set up Google Sign-In

1. In the owner's Google Cloud project, configure Google Auth Platform branding, support contact and audience for the MAYC site.
2. Create an OAuth client of type **Web application**.
3. Authorize `https://maycbukitbintang.com` and `https://www.maycbukitbintang.com` as JavaScript origins. Add a staging origin separately if required.
4. Use that client ID in both the Worker `GOOGLE_CLIENT_ID` and the site's `googleClientId` setting. This ID is public; no Google client secret belongs in the frontend.
5. Configure the Google app audience for the intended public users, rather than only private test users. The integration uses Google Identity Services' popup credential callback.

Official guidance:
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## Deploy the separate Cloudflare Worker

Run from this repository with an authenticated Wrangler session:

```sh
node scripts/sync-engagement-articles.mjs
npx wrangler d1 create mayc-article-engagement
```

Copy the returned database ID into `engagement-api/wrangler.jsonc`, replacing the placeholder. Set `GOOGLE_CLIENT_ID` to the Google web client ID. Keep `ALLOWED_ORIGINS` restricted to the actual website origins.

```sh
npx wrangler d1 migrations apply DB --remote --config engagement-api/wrangler.jsonc
npx wrangler deploy --config engagement-api/wrangler.jsonc
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put RATE_LIMIT_SALT --config engagement-api/wrangler.jsonc
```

The service fails closed for views if the salt is missing. No API credentials are published in the site.

Admin setup: on a controlled preview configured with the real Google client and Worker, sign in with the owner's selected Google account. The authenticated `/v1/me` response returns that account's `accountId`. Set this stable Google subject ID as a Worker secret (comma-separated if more than one admin is deliberately authorised):

```sh
npx wrangler secret put ADMIN_GOOGLE_SUBS --config engagement-api/wrangler.jsonc
```

No account can promote itself, and there is no first-user-becomes-admin rule. An empty allowlist grants no administrator access. Only the account owner/operator controlling Cloudflare can set the allowlist.

Official D1 guidance:
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/d1/worker-api/d1-database/

## Enable and verify

Set `src/data/engagement.json`:

```json
{
  "enabled": true,
  "apiBase": "https://YOUR-DEPLOYED-WORKER.workers.dev",
  "googleClientId": "YOUR-GOOGLE-WEB-CLIENT-ID.apps.googleusercontent.com"
}
```

Run `npm run test:engagement` (Node 24+) and `npm run build`, then publish the static website through its existing deployment. The build rejects missing or invalid configuration when engagement is enabled.

On the real site verify:

1. Logged-out readers can open every article and read comments without any login prompt blocking the page.
2. Refreshing the same article does not add views within the same UTC day.
3. A signed-in Google reader posts successfully and sees their profile name immediately. Text containing HTML is displayed as text.
4. A regular Google account receives a denial for admin endpoints; the configured admin can delete a comment and its public count decreases.
5. Test mobile layout and the genuine Google popup. These depend on the deployed origins and cannot be fully verified using placeholder configuration.

Google origin verification and Cloudflare deployment were not completed in the implementation session because account access/configuration was unavailable.

## Article updates and operations

The Worker uses a generated article allowlist. Whenever a new article slug is added, run `npm run engagement:sync` and redeploy the Worker alongside publishing the article. `engagement-api/src/articles.json` is generated from the existing Markdown content catalogue, including the bespoke `we-showed-up` route.

The daily scheduled task removes old deduplication rows and rate-limit buckets while preserving total views. Admin deletion removes a comment from the database and the public count. D1 backups/Time Travel are governed by the owner's Cloudflare settings.

Backend tests use real SQLite queries and cryptographically signed test JWTs. They cover public access, duplicate views, immediate comments, identity spoofing, retries, admin-only deletion, origin restrictions, rate limiting, pagination, expiry, wrong audience and forged JWT payloads.
