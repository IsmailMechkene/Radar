import { boardFrom, detectBoard } from '../src/core/sources/boards';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { upsertOpportunity } from '../src/core/db/opportunities';
import { createHttpClient } from '../src/core/http/client';
import { navCounts } from '../src/core/nav';
import { syncSeedPrograms, parseSeedPrograms } from '../src/core/programs/seeds';
import { scannableSources } from '../src/core/runner';
import {
  addSource,
  ashbyBoardFrom,
  deleteSource,
  listSourceItems,
  setSourcePaused,
  testFetch,
} from '../src/core/sources/manage';
import { parseSeedSources } from '../src/core/sources/seeds';
import { syncSeedSources } from '../src/core/sources/sync';
import { watchedPages } from '../src/core/watch/pages';
import { tempDb } from './helpers';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const TZ = 'Africa/Tunis';
const read = (rel: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', rel), 'utf8')) as unknown;

describe('sources page data', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    syncSeedSources(t.db, parseSeedSources(read('seeds/sources.json')), NOW);
    syncSeedPrograms(t.db, parseSeedPrograms(read('seeds/programs.json')), TZ, NOW);
  });
  afterEach(() => t.cleanup());
  const by = (name: string) => listSourceItems(t.db).find((s) => s.name === name)!;

  it('lists seeded sources, program pages and pending ones with their health', () => {
    const list = listSourceItems(t.db);
    expect(by('Mistral AI')).toMatchObject({
      kind: 'ashby',
      health: 'new',
      found: 0,
      config: { board: 'mistral.ai' },
    });
    expect(by('InstaDeep')).toMatchObject({ health: 'unavailable' });
    expect(by('InstaDeep').note).toMatch(/careers-page adapter/);
    expect(by('KAUST VSRP (program page)')).toMatchObject({
      kind: 'page',
      found: null,
      program: 'KAUST VSRP',
    });
    expect(list.every((s) => !s.added_by_user)).toBe(true);
  });

  it('health: broken after an error or 3 empty runs (same rule as the sidebar), warning before', () => {
    const id = by('DeepL').id;
    const set = (sql: string) => t.db.prepare(`UPDATE sources SET ${sql} WHERE id = ?`).run(id);
    set("last_ok_at = '2026-10-16T07:00:00.000Z'");
    expect(by('DeepL').health).toBe('healthy');
    set('consecutive_empty = 1');
    expect(by('DeepL').health).toBe('warning');
    set('consecutive_empty = 3');
    expect(by('DeepL').health).toBe('broken');
    expect(
      navCounts(t.db, { now: NOW, timeZone: TZ, newSince: NOW.toISOString() }).sourcesBroken,
    ).toBe(1);
    // Paused: not broken any more, and skipped by scans.
    setSourcePaused(t.db, id, true);
    expect(by('DeepL').health).toBe('paused');
    expect(
      navCounts(t.db, { now: NOW, timeZone: TZ, newSince: NOW.toISOString() }).sourcesBroken,
    ).toBe(0);
    expect(scannableSources(t.db).some((s) => s.name === 'DeepL')).toBe(false);
  });

  it('pausing survives seed sync; pending sources cannot be turned on', () => {
    setSourcePaused(t.db, by('Cohere').id, true);
    syncSeedSources(t.db, parseSeedSources(read('seeds/sources.json')), NOW); // next start
    expect(by('Cohere').paused).toBe(true);
    expect(() => setSourcePaused(t.db, by('InstaDeep').id, false)).toThrow(/no adapter/);
    setSourcePaused(t.db, by('IAESTE Tunisia (program page)').id, true);
    expect(watchedPages(t.db).some((s) => s.name.startsWith('IAESTE'))).toBe(false);
  });

  it('adds an Ashby board from its link, or a page to watch; validates both', () => {
    expect(ashbyBoardFrom('https://jobs.ashbyhq.com/Photoroom/abc?x=1')).toBe('Photoroom');
    expect(ashbyBoardFrom('examplelabs')).toBe('examplelabs');
    expect(ashbyBoardFrom('https://example.com/careers')).toBeNull();
    const board = addSource(
      t.db,
      { type: 'ashby', board: 'https://jobs.ashbyhq.com/examplelabs', org: 'Example Labs' },
      NOW,
    );
    expect(board).toMatchObject({
      kind: 'ashby',
      name: 'Example Labs',
      added_by_user: true,
      config: { board: 'examplelabs', org: 'Example Labs' },
    });
    expect(scannableSources(t.db).some((s) => s.name === 'Example Labs')).toBe(true);
    const page = addSource(
      t.db,
      { type: 'page', name: 'Lab internships', url: 'https://lab.example.edu/internships' },
      NOW,
    );
    expect(page).toMatchObject({ kind: 'page', access_method: 'public_html' });
    expect(() => addSource(t.db, { type: 'ashby', board: 'x', org: 'Example Labs' }, NOW)).toThrow(
      /already exists/,
    );
    expect(() =>
      addSource(t.db, { type: 'page', name: 'Bad', url: 'lab.example.edu' }, NOW),
    ).toThrow();
    expect(() =>
      addSource(t.db, { type: 'ashby', board: 'https://example.com/jobs', org: 'X' }, NOW),
    ).toThrow(/board link/);
  });

  it('adds Greenhouse and Lever boards from their links or names', () => {
    const gh = addSource(
      t.db,
      {
        type: 'greenhouse',
        board: 'https://job-boards.greenhouse.io/acmecorp/jobs/123',
        org: 'Acme Corp',
      },
      NOW,
    );
    expect(gh).toMatchObject({
      kind: 'greenhouse',
      name: 'Acme Corp',
      url: 'https://job-boards.greenhouse.io/acmecorp',
      access_method: 'api',
      added_by_user: true,
      config: { board: 'acmecorp', org: 'Acme Corp' },
    });
    const lever = addSource(t.db, { type: 'lever', board: 'globex', org: 'Globex' }, NOW);
    expect(lever).toMatchObject({
      kind: 'lever',
      url: 'https://jobs.lever.co/globex',
      config: { site: 'globex', org: 'Globex' },
    });
    expect(scannableSources(t.db).map((s) => s.name)).toEqual(
      expect.arrayContaining(['Acme Corp', 'Globex']),
    );
    // A link of another site is not a board name.
    expect(() =>
      addSource(t.db, { type: 'lever', board: 'https://jobs.ashbyhq.com/x', org: 'X' }, NOW),
    ).toThrow(/jobs\.lever\.co/);
  });

  it('recognizes board links of every platform', () => {
    expect(detectBoard('https://jobs.ashbyhq.com/Photoroom/abc')).toEqual({
      platform: 'ashby',
      board: 'Photoroom',
    });
    expect(detectBoard('boards.greenhouse.io/stripe')).toEqual({
      platform: 'greenhouse',
      board: 'stripe',
    });
    expect(detectBoard('https://job-boards.greenhouse.io/embed/job_board?for=datadog&b=1')).toEqual(
      { platform: 'greenhouse', board: 'datadog' },
    );
    expect(detectBoard('https://jobs.lever.co/palantir/6ed76ce8?lever-via=x')).toEqual({
      platform: 'lever',
      board: 'palantir',
    });
    expect(detectBoard('https://bunq.recruitee.com/o/audit-automation-intern')).toEqual({
      platform: 'recruitee',
      board: 'bunq',
    });
    expect(detectBoard('https://notrecruitee.com/x')).toBeNull();
    expect(detectBoard('datadog')).toBeNull();
    expect(detectBoard('https://www.linkedin.com/jobs/view/1')).toBeNull();
    expect(boardFrom('greenhouse', ' datadog ')).toBe('datadog');
    expect(boardFrom('greenhouse', 'https://jobs.lever.co/x')).toBeNull();
  });

  it('deletes only sources you added that found nothing', () => {
    const added = addSource(
      t.db,
      { type: 'page', name: 'Lab', url: 'https://lab.example.edu/' },
      NOW,
    );
    expect(deleteSource(t.db, added.id)).toBe(1);
    expect(() => deleteSource(t.db, by('Cohere').id)).toThrow(/pause it instead/);
    const board = addSource(t.db, { type: 'ashby', board: 'acme', org: 'Acme' }, NOW);
    upsertOpportunity(
      t.db,
      {
        dedupe_key: 'acme|intern|',
        source_id: board.id,
        org: 'Acme',
        title: 'Intern',
        opportunity_type: 'internship',
        url: 'https://acme.test/1',
      },
      NOW,
    );
    expect(() => deleteSource(t.db, board.id)).toThrow(/found 1 posting; pause it instead/);
  });
});

describe('test fetch', () => {
  const http = (routes: Record<string, () => Response>) =>
    createHttpClient({
      fetch: async (url) => (routes[url] ?? (() => new Response('', { status: 404 })))(),
      now: () => 0,
      sleep: async () => {},
    });

  it('runs the adapter and stores nothing', async () => {
    const payload = readFileSync(
      join(__dirname, '..', 'fixtures', 'ashby', 'cohere-job-board.json'),
      'utf8',
    );
    let t = 0;
    const r = await testFetch(
      { kind: 'ashby', name: 'Cohere', url: null, config: { board: 'cohere', org: 'Cohere' } },
      http({ 'https://api.ashbyhq.com/posting-api/job-board/cohere': () => new Response(payload) }),
      () => (t += 400),
    );
    expect(r).toMatchObject({ ok: true, kind: 'items', ms: 400 });
    if (r.ok && r.kind === 'items') {
      expect(r.total).toBeGreaterThan(0);
      expect(r.items[0]).toMatchObject({ org: 'Cohere', url: expect.stringMatching(/^https:/) });
    }
  });

  it('shows the normalized text of a page, and failures as text', async () => {
    const page = await testFetch(
      { kind: 'page', name: 'Lab', url: 'https://lab.test/', config: {} },
      http({
        'https://lab.test/': () =>
          new Response('<nav>Menu</nav><h1>Internships</h1><p>Apply by 1 March 2027</p>'),
      }),
    );
    expect(page).toMatchObject({
      ok: true,
      kind: 'page',
      totalLines: 2,
      lines: ['Internships', 'Apply by 1 March 2027'],
    });
    const failed = await testFetch(
      { kind: 'page', name: 'Gone', url: 'https://gone.test/', config: {} },
      http({}),
    );
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/404/) });
    const noAdapter = await testFetch(
      { kind: 'careers_page', name: 'X', url: null, config: {} },
      http({}),
    );
    expect(noAdapter).toMatchObject({ ok: false, error: 'No adapter for "careers_page" yet' });
  });
});
