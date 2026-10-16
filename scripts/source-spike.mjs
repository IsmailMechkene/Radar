// Throwaway research helper for the source spike (docs/source-spike.md). Not part of the app.
// Fetches each URL politely (Radar User-Agent, sequential, >= 1.1 s between requests) and saves
// the body plus status/headers so responses can be inspected and trimmed into fixtures.
//
// Usage: node scripts/source-spike.mjs <outDir> <url> [url...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UA =
  'Radar/0.1 (personal internship search app; local-first; contact: github.com/IsmailMechkene/Radar)';
const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || urls.length === 0) {
  console.error('Usage: node scripts/source-spike.mjs <outDir> <url> [url...]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const slug = (u) =>
  u
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, 120);

let last = 0;
for (const url of urls) {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, application/rss+xml, text/html;q=0.9, */*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    const name = slug(url);
    writeFileSync(join(outDir, `${name}.body`), body);
    writeFileSync(
      join(outDir, `${name}.meta.json`),
      JSON.stringify(
        { url, finalUrl: res.url, status: res.status, headers: Object.fromEntries(res.headers) },
        null,
        2,
      ),
    );
    console.log(
      `${res.status} ${res.headers.get('content-type') ?? '-'} ${body.length}B  ${url} -> ${name}`,
    );
  } catch (err) {
    console.log(`ERR ${err.cause?.code ?? err.name} ${err.message}  ${url}`);
  }
}
