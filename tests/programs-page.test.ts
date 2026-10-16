import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { listDeadlines } from '../src/core/deadlines/list';
import { createHttpClient } from '../src/core/http/client';
import {
  createProgram,
  deleteProgram,
  getProgram,
  listPrograms,
  markAlertReviewed,
  updateProgram,
} from '../src/core/programs/manage';
import { parseSeedPrograms, syncSeedPrograms } from '../src/core/programs/seeds';
import { zonedParts } from '../src/core/time';
import { watchPages } from '../src/core/watch/pages';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const seeds = parseSeedPrograms(
  JSON.parse(readFileSync(join(__dirname, '..', 'seeds', 'programs.json'), 'utf8')),
);
const day = (iso: string | null) => {
  if (!iso) return null;
  const p = zonedParts(new Date(iso), TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

describe('programs page data', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    syncSeedPrograms(t.db, seeds, TZ, NOW);
  });
  afterEach(() => t.cleanup());
  const byName = (name: string) => listPrograms(t.db).find((p) => p.name === name)!;

  it('lists seeded programs with their watched page', () => {
    const list = listPrograms(t.db);
    expect(list).toHaveLength(8);
    expect(list.every((p) => p.seeded)).toBe(true);
    expect(byName('Google Summer of Code').watch_url).toBe(
      'https://developers.google.com/open-source/gsoc/timeline?hl=en',
    );
    expect(byName('MBZUAI UGRIP').watch_url).toBeNull();
  });

  it('confirming a date from the page makes it the user’s: seed sync no longer overwrites it', () => {
    const ugrip = byName('MBZUAI UGRIP');
    const saved = updateProgram(
      t.db,
      ugrip.id,
      {
        deadline_date: '2027-02-15',
        deadline_status: 'confirmed',
        url: 'https://mbzuai.ac.ae/ugrip/',
      },
      TZ,
      NOW,
    );
    expect(day(saved.expected_deadline_at)).toBe('2027-02-15');
    expect(saved).toMatchObject({
      deadline_status: 'confirmed',
      watch_url: 'https://mbzuai.ac.ae/ugrip/',
    });
    expect(saved.edited_at).toBe(NOW.toISOString());

    syncSeedPrograms(t.db, seeds, TZ, NOW); // next app start
    expect(byName('MBZUAI UGRIP')).toMatchObject({
      deadline_status: 'confirmed',
      url: 'https://mbzuai.ac.ae/ugrip/',
    });
    expect(day(byName('MBZUAI UGRIP').expected_deadline_at)).toBe('2027-02-15');
    // The Deadlines page now shows it as confirmed.
    const ev = listDeadlines(t.db, NOW).events.find(
      (e) => e.key === `program:${ugrip.id}:deadline`,
    );
    expect(ev?.status).toBe('confirmed');
  });

  it('changing the watched page starts a new baseline', async () => {
    const gsoc = byName('Google Summer of Code');
    let body = '<p>Contributor applications: March 16 - 31</p>';
    const http = createHttpClient({
      fetch: async (url) =>
        url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response(body),
      now: () => 0,
      sleep: async () => {},
    });
    await watchPages(t.db, { http, now: NOW, force: true });
    updateProgram(
      t.db,
      gsoc.id,
      { url: 'https://summerofcode.withgoogle.com/how-it-works' },
      TZ,
      NOW,
    );
    body = '<p>Something completely different</p>';
    const r = await watchPages(t.db, { http, now: NOW, force: true });
    expect(r.find((x) => x.source.startsWith('Google'))?.outcome).toBe('baseline');
    expect(byName('Google Summer of Code').alert_id).toBeNull();
  });

  it('a seed that moves a watched page starts a new baseline', () => {
    const gsoc = byName('Google Summer of Code');
    t.db
      .prepare(
        'INSERT INTO page_snapshots (source_id, content_hash, text_excerpt, fetched_at) VALUES (?, ?, ?, ?)',
      )
      .run(gsoc.source_id, 'abc', 'old page', NOW.toISOString());
    const moved = seeds.map((s) =>
      s.name === 'Google Summer of Code'
        ? { ...s, watch_url: 'https://summerofcode.withgoogle.com/timeline' }
        : s,
    );
    syncSeedPrograms(t.db, moved, TZ, NOW);
    expect(byName('Google Summer of Code').watch_url).toBe(
      'https://summerofcode.withgoogle.com/timeline',
    );
    expect(
      t.db
        .prepare('SELECT COUNT(*) FROM page_snapshots WHERE source_id = ?')
        .pluck()
        .get(gsoc.source_id),
    ).toBe(0);
    // Unchanged URL: the baseline stays.
    t.db
      .prepare(
        'INSERT INTO page_snapshots (source_id, content_hash, text_excerpt, fetched_at) VALUES (?, ?, ?, ?)',
      )
      .run(gsoc.source_id, 'def', 'page', NOW.toISOString());
    syncSeedPrograms(t.db, moved, TZ, NOW);
    expect(
      t.db
        .prepare('SELECT COUNT(*) FROM page_snapshots WHERE source_id = ?')
        .pluck()
        .get(gsoc.source_id),
    ).toBe(1);
  });

  it('shows the latest unreviewed alert, changed programs first; Mark reviewed clears it', () => {
    const iaeste = byName('IAESTE Tunisia');
    t.db
      .prepare(
        `INSERT INTO alerts (kind, source_id, program_id, title, body, created_at)
         VALUES ('page_changed', ?, ?, 'IAESTE Tunisia: page changed, review', '- Nominations close 9 November\n+ Nominations close 16 November', ?)`,
      )
      .run(iaeste.source_id, iaeste.id, NOW.toISOString());
    const first = listPrograms(t.db)[0]!;
    expect(first).toMatchObject({
      name: 'IAESTE Tunisia',
      alert_body: expect.stringContaining('16 November'),
    });
    markAlertReviewed(t.db, first.alert_id!, NOW);
    expect(byName('IAESTE Tunisia').alert_id).toBeNull();
    expect(() => markAlertReviewed(t.db, first.alert_id!, NOW)).toThrow(/No unreviewed alert/);
  });

  it('saving from an alert marks it reviewed', () => {
    const p = byName('InstaDeep Tunis PFE');
    const { id: alertId } = t.db
      .prepare(
        `INSERT INTO alerts (kind, source_id, program_id, title, body, created_at)
         VALUES ('page_changed', ?, ?, 'x', '+ PFE applications close 20 November', ?) RETURNING id`,
      )
      .get(p.source_id, p.id, NOW.toISOString()) as { id: number };
    updateProgram(
      t.db,
      p.id,
      { deadline_date: '2026-11-20', deadline_status: 'confirmed', review_alert_id: alertId },
      TZ,
      NOW,
    );
    expect(getProgram(t.db, p.id)).toMatchObject({ alert_id: null, deadline_status: 'confirmed' });
  });

  it('adds and deletes your own programs; seeded ones are kept', () => {
    const created = createProgram(
      t.db,
      {
        name: 'Mitacs Globalink',
        org: 'Mitacs',
        url: 'https://www.mitacs.ca/',
        status: 'watching',
        deadline_status: 'expected',
        deadline_date: '2027-09-16',
      },
      TZ,
      NOW,
    );
    expect(created).toMatchObject({ seeded: false, watch_url: 'https://www.mitacs.ca/' });
    expect(() => createProgram(t.db, { name: 'Mitacs Globalink' }, TZ, NOW)).toThrow(
      /already exists/,
    );
    expect(() => updateProgram(t.db, created.id, { name: 'KAUST VSRP' }, TZ, NOW)).toThrow(
      /already exists/,
    );
    expect(() => updateProgram(t.db, created.id, { url: 'mitacs.ca' }, TZ, NOW)).toThrow();
    expect(deleteProgram(t.db, created.id)).toBe(1);
    expect(
      t.db.prepare("SELECT COUNT(*) FROM sources WHERE name LIKE 'Mitacs%'").pluck().get(),
    ).toBe(0);
    expect(() => deleteProgram(t.db, byName('KAUST VSRP').id)).toThrow(/Not applicable/);
  });
});
