import { readdirSync, writeFileSync } from 'node:fs';
const files = readdirSync(new URL('../src/content/artikel/', import.meta.url));
const slugs = files.filter(f => /\.mdx?$/.test(f)).map(f => f.replace(/\.mdx?$/, '')).sort();
writeFileSync(new URL('../engagement-api/src/articles.json', import.meta.url), JSON.stringify(slugs, null, 2) + '\n');
console.log(`Synced ${slugs.length} article IDs.`);
