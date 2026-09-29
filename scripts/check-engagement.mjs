import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../src/data/engagement.json', import.meta.url), 'utf8'));
if (config.enabled || config.analyticsEnabled) {
  const url = new URL(config.apiBase);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Engagement API must be a valid HTTPS origin.');
}
