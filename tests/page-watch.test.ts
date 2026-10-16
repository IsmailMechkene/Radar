import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { insertSource } from '../src/core/db/sources';
import { createHttpClient, type FetchFn } from '../src/core/http/client';
import { diffText, hashText, normalizePageText, watchPages } from '../src/core/watch/pages';
import { tempDb } from './helpers';

const page = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'pages', `${name}.html`), 'utf8');
const V1 = page('program-v1');
const V1_TIME = page('program-v1-timestamp');
const V2 = page('program-v2');
const URL_ = 'https://uni.test/research-internships';

describe('page normalization', () => {
  it('keeps the content and drops scripts, navigation, cookie banners and timestamps', () => {
    const text = normalizePageText(V1);
    expect(text).toContain('Application deadline: 28 February 2027');
    expect(text).toContain('Eligibility: CGPA 3.5/4 or equivalent.');
    expect(text).not.toMatch(
      /__BUILD__|font-family|cookies|Contact|Last updated|©|09:14|minutes ago/,
    );
  });

  it('a page that only changed its timestamps hashes the same', () => {
    expect(normalizePageText(V1_TIME)).toBe(normalizePageText(V1));
    expect(hashText(normalizePageText(V1_TIME))).toBe(hashText(normalizePageText(V1)));
  });

  it('a real change hashes differently and diffs to the changed lines', () => {
    const a = normalizePageText(V1);
    const b = normalizePageText(V2);
    expect(hashText(a)).not.toBe(hashText(b));
    expect(diffText(a, b)).toBe(
      [
        '- • Application deadline: 28 February 2027',
        '+ • Application deadline: 15 February 2027',
        '+ New this year: a recommendation letter is required.',
      ].join('\n'),
    );
  });

  it('caps long diffs', () => {
    const a = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const b = Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n');
    const d = diffText(a, b, 4).split('\n');
    expect(d).toHaveLength(5);
    expect(d[4]).toBe('… 56 more changed lines');
  });
});

describe('watchPages', () => {
  let t: ReturnType<typeof tempDb>;
  let body = V1;
  let clock = Date.parse('2026-10-16T08:00:00.000Z');
  const fetchFn: FetchFn = async (url) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url === URL_) return new Response(body, { headers: { 'content-type': 'text/html' } });
    return new Response('gone', { status: 404 });
  };
  const http = () =>
    createHttpClient({ fetch: fetchFn, now: () => clock, sleep: async (ms) => void (clock += ms) });
  const at = (iso: string) => {
    clock = Date.parse(iso);
    return new Date(iso);
  };

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    body = V1;
    const src = insertSource(
      t.db,
      { kind: 'page', name: 'Uni program page', url: URL_, access_method: 'public_html' },
      new Date('2026-10-01T00:00:00Z'),
    );
    t.db
      .prepare("INSERT INTO programs (name, source_id) VALUES ('Uni Research Internship', ?)")
      .run(src.id);
  });
  afterEach(() => t.cleanup());

  const alerts = () =>
    t.db.prepare('SELECT title, body, program_id FROM alerts ORDER BY id').all() as {
      title: string;
      body: string;
      program_id: number | null;
    }[];
  const snapshots = () =>
    (t.db.prepare('SELECT COUNT(*) FROM page_snapshots').pluck().get() as number) ?? 0;

  it('asks for English pages, so a page that localizes by IP does not look changed', async () => {
    const langs: (string | undefined)[] = [];
    const client = createHttpClient({
      fetch: async (url, init) => {
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
        langs.push((init.headers as Record<string, string>)['Accept-Language']);
        return new Response(V1);
      },
      now: () => clock,
      sleep: async () => {},
    });
    await watchPages(t.db, { http: client, now: at('2026-10-16T08:00:00.000Z') });
    expect(langs).toEqual(['en-US,en;q=0.9']);
  });

  it('first fetch sets the baseline without an alert', async () => {
    const r = await watchPages(t.db, { http: http(), now: at('2026-10-16T08:00:00.000Z') });
    expect(r).toEqual([{ source: 'Uni program page', outcome: 'baseline' }]);
    expect(snapshots()).toBe(1);
    expect(alerts()).toEqual([]);
  });

  it('a timestamp-only change does not alert; a real change alerts once with a diff', async () => {
    const client = http();
    await watchPages(t.db, { http: client, now: at('2026-10-16T08:00:00.000Z') });

    body = V1_TIME;
    const same = await watchPages(t.db, { http: client, now: at('2026-10-17T18:05:00.000Z') });
    expect(same[0]!.outcome).toBe('unchanged');
    expect(alerts()).toEqual([]);

    body = V2;
    const changed = await watchPages(t.db, { http: client, now: at('2026-10-20T12:00:00.000Z') });
    expect(changed[0]!.outcome).toBe('changed');
    const [alert] = alerts();
    expect(alert!.title).toBe('Uni Research Internship: page changed, review');
    expect(alert!.body).toContain('+ • Application deadline: 15 February 2027');
    expect(alert!.program_id).not.toBeNull();
    expect(snapshots()).toBe(2);

    // Unchanged afterwards: no second alert.
    await watchPages(t.db, { http: client, now: at('2026-10-21T12:00:00.000Z') });
    expect(alerts()).toHaveLength(1);
  });

  it('checks a page about once a day', async () => {
    const client = http();
    await watchPages(t.db, { http: client, now: at('2026-10-16T08:00:00.000Z') });
    const again = await watchPages(t.db, { http: client, now: at('2026-10-16T12:00:00.000Z') });
    expect(again[0]!.outcome).toBe('skipped');
    expect(t.db.prepare('SELECT next_check_at FROM programs').pluck().get()).toBe(
      '2026-10-17T04:00:00.000Z',
    );
  });

  it('a failing page is recorded on the source, not thrown', async () => {
    t.db.prepare("UPDATE sources SET url = 'https://uni.test/missing'").run();
    const r = await watchPages(t.db, { http: http(), now: at('2026-10-16T08:00:00.000Z') });
    expect(r[0]!.outcome).toBe('failed');
    expect(t.db.prepare('SELECT last_error FROM sources').pluck().get()).toMatch(/404/);
  });

  it('respects robots.txt through the shared fetch layer', async () => {
    const blocked = createHttpClient({
      fetch: async (url) =>
        url.endsWith('/robots.txt')
          ? new Response('User-agent: *\nDisallow: /research')
          : new Response(V1),
      now: () => clock,
      sleep: async () => {},
    });
    const r = await watchPages(t.db, { http: blocked, now: at('2026-10-16T08:00:00.000Z') });
    expect(r[0]).toMatchObject({ outcome: 'failed' });
    expect(r[0]!.outcome === 'failed' && r[0]!.error).toMatch(/robots/);
  });
});
