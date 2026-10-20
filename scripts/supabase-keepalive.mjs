// Keeps the Supabase project from being paused for inactivity (free projects pause after about
// a week without database activity). Calls the keepalive() function through the REST API with
// the publishable key (supabase/migrations/20261020120000_keepalive.sql): it runs in Postgres,
// which is what counts as activity, and returns only the server time (no user data).
//
// Run locally:  npm run supabase:keepalive        (reads .env)
// Scheduled:    .github/workflows/supabase-keepalive.yml (repository secrets SUPABASE_URL and
//               SUPABASE_KEY, the same values as MAIN_VITE_SUPABASE_URL / MAIN_VITE_SUPABASE_KEY)
//
// Exits non-zero when the request fails, so a failing scheduled run is reported, never silent.

const url = process.env.SUPABASE_URL ?? process.env.MAIN_VITE_SUPABASE_URL;
const key = process.env.SUPABASE_KEY ?? process.env.MAIN_VITE_SUPABASE_KEY;

if (!url || !key) {
  console.error('[keepalive] set SUPABASE_URL and SUPABASE_KEY (or the MAIN_VITE_ ones in .env)');
  process.exit(1);
}

const endpoint = new URL('/rest/v1/rpc/keepalive', url);
const started = Date.now();
try {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[keepalive] ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[keepalive] ok: server time ${JSON.parse(body)} (${Date.now() - started} ms)`);
} catch (err) {
  console.error(`[keepalive] request failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
