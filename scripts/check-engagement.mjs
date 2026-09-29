import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../src/data/engagement.json', import.meta.url), 'utf8'));
if (config.enabled) {
  const url = new URL(config.apiBase);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Engagement API must be a valid HTTPS origin.');
  if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(config.googleClientId)) throw new Error('Configure the Google web client ID before enabling comments.');
}
