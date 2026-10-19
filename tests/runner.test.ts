import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ashbyAdapter } from '../src/core/adapters/ashby';
import type { Adapter, AdapterResult, RawItem } from '../src/core/adapters/types';
import { migrate } from '../src/core/db/migrate';
import { getOpportunityDetail, listOpportunityItems } from '../src/core/db/opportunities';
import { latestFinishedRun, latestSuccessfulRun } from '../src/core/db/runs';
import { canonicalUrl, dedupeKey, normalizeText } from '../src/core/dedupe';
import { createHttpClient, type FetchFn } from '../src/core/http/client';
import { defaultDataDir } from '../src/core/paths';
import { runScan, scannableSources } from '../src/core/runner';
import { parseSeedSources } from '../src/core/sources/seeds';
import { syncSeedSources } from '../src/core/sources/sync';
import { tempDb } from './helpers';

const T0 = new Date('2026-10-16T08:00:00.000Z');
const later = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe('dedupe', () => {
  it('normalizes titles across boards', () => {
    expect(normalizeText('Werkstudent Backend (m/w/d)')).toBe('werkstudent backend');
    expect(normalizeText('Stagiaire Développeur IA (H/F)')).toBe('stagiaire developpeur ia');
    expect(normalizeText('ML Engineer – Paris & Remote')).toBe('ml engineer paris and remote');
    expect(normalizeText(null)).toBe('');
  });

  it('builds the SPEC key lower(org) | title | location', () => {
    expect(
      dedupeKey({ org: 'Mistral AI', title: 'Applied Scientist  (Internship)', location: 'Paris' }),
    ).toBe('mistral ai|applied scientist internship|paris');
  });

  it('canonical URLs drop tracking and noise but keep identifying params', () => {
    expect(canonicalUrl('http://www.Example.com/jobs/1/?utm_source=x&b=2&a=1#apply')).toBe(
      'https://example.com/jobs/1?a=1&b=2',
    );
    expect(
      canonicalUrl('https://careers.datadoghq.com/detail/8257324/?gh_jid=8257324&gh_src=abc'),
    ).toBe('https://careers.datadoghq.com/detail/8257324?gh_jid=8257324');
  });
});

describe('paths', () => {
  it('matches Electron userData for the app name "radar"', () => {
    expect(
      defaultDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'),
    ).toMatch(/AppData[\\/]Roaming[\\/]radar$/);
    expect(defaultDataDir('darwin', {}, '/Users/a')).toBe(
      join('/Users/a', 'Library', 'Application Support', 'radar'),
    );
    expect(defaultDataDir('linux', {}, '/home/a')).toBe(join('/home/a', '.config', 'radar'));
  });
});

const seedsRaw = JSON.parse(
  readFileSync(join(__dirname, '../seeds/sources.json'), 'utf8'),
) as unknown;

describe('seed sync', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('inserts once, then only updates; pending seeds are disabled', () => {
    const seeds = parseSeedSources(seedsRaw);
    const n = seeds.length;
    expect(syncSeedSources(t.db, seeds, T0)).toEqual({ inserted: n, updated: 0 });
    expect(syncSeedSources(t.db, seeds, T0)).toEqual({ inserted: 0, updated: n });
    expect(t.db.prepare('SELECT COUNT(*) FROM sources').pluck().get()).toBe(n);
    const enabled = t.db
      .prepare('SELECT name FROM sources WHERE enabled = 1 ORDER BY id')
      .pluck()
      .all();
    expect(enabled).not.toContain('InstaDeep');
    expect(enabled).not.toContain('Entrelacs');
    expect(scannableSources(t.db)).toHaveLength(seeds.filter((s) => s.status === 'active').length);
  });
});

/** A fake adapter whose items are set per call. */
function fakeAdapter(kind: string) {
  let next: AdapterResult | Error = { items: [], errors: [] };
  const adapter: Adapter = {
    kind,
    configSchema: {} as Adapter['configSchema'],
    fetchItems: () => (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)),
  };
  return {
    adapter,
    set(r: AdapterResult | Error) {
      next = r;
    },
  };
}

function item(over: Partial<RawItem> = {}): RawItem {
  return {
    external_id: 'x1',
    org: 'Acme',
    title: 'ML Intern',
    location: 'Paris',
    remote_type: 'onsite',
    url: 'https://jobs.example.com/acme/1',
    apply_url: null,
    description: 'Python',
    posted_at: '2026-10-15T08:00:00.000Z',
    deadline_text: null,
    opportunity_type: 'internship',
    language: 'en',
    raw: {},
    ...over,
  };
}

describe('runScan', () => {
  let t: ReturnType<typeof tempDb>;
  const a = fakeAdapter('fake-a');
  const b = fakeAdapter('fake-b');
  const adapters = { 'fake-a': a.adapter, 'fake-b': b.adapter };
  const http = createHttpClient({ fetch: async () => new Response('', { status: 404 }) });
  const scan = (at: Date, only?: string[]) =>
    runScan(t.db, { http, trigger: 'manual', adapters, now: () => at, only });

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    const insert = t.db.prepare(
      "INSERT INTO sources (kind, name, access_method, enabled, created_at) VALUES (?, ?, 'api', ?, ?)",
    );
    insert.run('fake-a', 'Board A', 1, T0.toISOString());
    insert.run('fake-b', 'Board B', 1, T0.toISOString());
    insert.run('fake-a', 'Disabled', 0, T0.toISOString());
    insert.run('sample', 'Sample', 1, T0.toISOString()); // no adapter: never scanned
    a.set({ items: [], errors: [] });
    b.set({ items: [], errors: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    t.cleanup();
  });

  it('scanning the same result twice yields zero new rows (M3)', async () => {
    a.set({
      items: [
        item(),
        item({
          external_id: 'x2',
          title: 'Backend Intern',
          url: 'https://jobs.example.com/acme/2',
        }),
      ],
      errors: [],
    });
    const first = await scan(T0);
    expect(first.newItems).toBe(2);
    expect(first.outcomes.map((o) => o.name)).toEqual(['Board A', 'Board B']);
    const second = await scan(later(1));
    expect(second.newItems).toBe(0);
    expect(second.outcomes[0]).toMatchObject({ inserted: 0, updated: 2, closed: 0 });
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(2);
    const row = listOpportunityItems(t.db)[0]!;
    expect(row.first_seen_at).toBe(T0.toISOString());
  });

  it('a removed posting gets closed_at, and reopens if it comes back (M3)', async () => {
    const keep = item();
    const gone = item({
      external_id: 'x2',
      title: 'Backend Intern',
      url: 'https://jobs.example.com/acme/2',
    });
    a.set({ items: [keep, gone], errors: [] });
    await scan(T0);
    a.set({ items: [keep], errors: [] });
    const s = await scan(later(1));
    expect(s.outcomes[0]!.closed).toBe(1);
    const closed = t.db
      .prepare("SELECT closed_at FROM opportunities WHERE title = 'Backend Intern'")
      .pluck()
      .get();
    expect(closed).toBe(later(1).toISOString());
    expect(listOpportunityItems(t.db).map((i) => i.title)).toEqual(['ML Intern']); // closed are hidden

    a.set({ items: [keep, gone], errors: [] });
    await scan(later(2));
    expect(
      t.db
        .prepare("SELECT closed_at FROM opportunities WHERE title = 'Backend Intern'")
        .pluck()
        .get(),
    ).toBeNull();
  });

  it('an empty answer closes nothing and counts as empty', async () => {
    a.set({ items: [item()], errors: [] });
    await scan(T0);
    a.set({ items: [], errors: [] });
    const s = await scan(later(1));
    expect(s.outcomes[0]!.closed).toBe(0);
    expect(s.errorSummary).toContain('Board A: returned no items');
    expect(
      t.db.prepare("SELECT consecutive_empty FROM sources WHERE name = 'Board A'").pluck().get(),
    ).toBe(1);
    expect(
      t.db.prepare('SELECT COUNT(*) FROM opportunities WHERE closed_at IS NULL').pluck().get(),
    ).toBe(1);
  });

  it('a failing source is logged, keeps its items open and does not stop the others', async () => {
    a.set({ items: [item()], errors: [] });
    b.set({ items: [item({ org: 'Beta', url: 'https://beta.example.com/1' })], errors: [] });
    await scan(T0);
    a.set(new Error('GET https://jobs.example.com answered 503'));
    const s = await scan(later(1));
    expect(s).toMatchObject({ sourcesOk: 1, sourcesFailed: 1 });
    expect(s.errorSummary).toContain('Board A: GET https://jobs.example.com answered 503');
    expect(
      t.db.prepare("SELECT last_error FROM sources WHERE name = 'Board A'").pluck().get(),
    ).toMatch(/503/);
    expect(
      t.db.prepare('SELECT COUNT(*) FROM opportunities WHERE closed_at IS NULL').pluck().get(),
    ).toBe(2);
    const run = latestFinishedRun(t.db)!;
    expect(run).toMatchObject({
      trigger: 'manual',
      sources_ok: 1,
      sources_failed: 1,
      new_items: 0,
    });
    expect(latestSuccessfulRun(t.db)?.id).toBe(run.id);
  });

  it('merges the same posting from two sources and closes it only when both lost it', async () => {
    a.set({ items: [item()], errors: [] });
    b.set({
      items: [item({ url: 'https://other-board.example.com/x?utm_source=feed' })],
      errors: [],
    });
    await scan(T0);
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(1);
    const id = listOpportunityItems(t.db)[0]!.id;
    expect(getOpportunityDetail(t.db, id)!.sources.map((s) => s.url)).toEqual([
      'https://jobs.example.com/acme/1',
      'https://other-board.example.com/x',
    ]);

    a.set({
      items: [
        item({
          external_id: 'other',
          title: 'Data Intern',
          url: 'https://jobs.example.com/acme/9',
        }),
      ],
      errors: [],
    });
    await scan(later(1), ['Board A']);
    expect(getOpportunityDetail(t.db, id)!.closed_at).toBeNull(); // still listed by Board B

    b.set({
      items: [item({ org: 'Beta', title: 'Other', url: 'https://beta.example.com/2' })],
      errors: [],
    });
    await scan(later(2), ['board b']);
    expect(getOpportunityDetail(t.db, id)!.closed_at).toBe(later(2).toISOString());
  });

  it('the same canonical URL with an edited title stays one opportunity', async () => {
    a.set({ items: [item()], errors: [] });
    await scan(T0);
    a.set({ items: [item({ title: 'Machine Learning Intern (Summer 2027)' })], errors: [] });
    const s = await scan(later(1));
    expect(s.newItems).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) FROM opportunities').pluck().get()).toBe(1);
    expect(listOpportunityItems(t.db)[0]!.title).toBe('Machine Learning Intern (Summer 2027)');
  });

  it('stores unknown types as fulltime and reports skipped items', async () => {
    a.set({
      items: [item({ opportunity_type: 'unknown' })],
      errors: [{ index: 1, externalId: 'bad', reason: 'title: Required', raw: {} }],
    });
    const s = await scan(T0);
    expect(listOpportunityItems(t.db)[0]!.opportunity_type).toBe('fulltime');
    expect(s.outcomes[0]!.skipped).toBe(1);
    expect(s.errorSummary).toContain('Board A: 1 item(s) skipped as malformed');
  });
});

describe('runScan with the real Ashby adapter and a recorded fixture', () => {
  it('stores every job and is idempotent', async () => {
    const t = tempDb();
    try {
      migrate(t.db);
      syncSeedSources(t.db, parseSeedSources(seedsRaw), T0);
      const fixture = readFileSync(
        join(__dirname, '../fixtures/ashby/mistral-ai-job-board.json'),
        'utf8',
      );
      const fetchFn: FetchFn = async (url) =>
        url.endsWith('/mistral.ai') ? new Response(fixture) : new Response('', { status: 404 });
      const http = createHttpClient({ fetch: fetchFn, now: () => 0, sleep: async () => {} });
      const run = () =>
        runScan(t.db, {
          http,
          trigger: 'cli',
          only: ['Mistral AI'],
          now: () => T0,
          adapters: { ashby: ashbyAdapter as Adapter },
        });
      expect((await run()).newItems).toBe(3);
      expect((await run()).newItems).toBe(0);
      const types = listOpportunityItems(t.db)
        .map((i) => i.opportunity_type)
        .sort();
      expect(types).toEqual(['fulltime', 'internship', 'internship']);
    } finally {
      t.cleanup();
    }
  });
});
