import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getOpportunityDetail, upsertOpportunity } from '../src/core/db/opportunities';
import { insertSource } from '../src/core/db/sources';
import { extractDeadlines, postingDeadline } from '../src/core/deadlines/postings';
import {
  EXPECTED_LABEL,
  parseSeedPrograms,
  syncSeedPrograms,
  type SeedProgram,
} from '../src/core/programs/seeds';
import { syncReminders } from '../src/core/reminders/store';
import { compileRules } from '../src/core/rules/engine';
import { profileFromSettings } from '../src/core/rules/profile';
import { rescoreAll } from '../src/core/rules/rescore';
import { parseRules } from '../src/core/rules/schema';
import { DEFAULT_SETTINGS } from '../src/core/settings/schema';
import { zonedParts } from '../src/core/time';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const read = (rel: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', rel), 'utf8')) as unknown;
const programs = parseSeedPrograms(read('seeds/programs.json'));
const day = (iso: string | null) => {
  if (!iso) return null;
  const p = zonedParts(new Date(iso), TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

describe('postingDeadline', () => {
  const base = {
    description: null,
    deadline_text: null,
    posted_at: '2026-10-10T09:00:00.000Z',
    first_seen_at: '2026-10-16T08:00:00.000Z',
    language: 'en' as const,
  };

  it('a stated date is confirmed, with its sentence', () => {
    const d = postingDeadline(
      { ...base, description: 'Great team.\nApply by 30 November 2026. Thanks!' },
      TZ,
    );
    expect(d).toEqual({
      status: 'confirmed',
      deadline_at: '2026-11-30T22:59:59.999Z',
      sentence: 'Apply by 30 November 2026.',
      note: null,
    });
  });

  it('rolling and "until filled" are rolling; a stated date still wins', () => {
    expect(postingDeadline({ ...base, description: 'Open until filled.' }, TZ).status).toBe(
      'rolling',
    );
    expect(
      postingDeadline(
        { ...base, description: 'We hire on a rolling basis. Deadline: 15 Jan 2027.' },
        TZ,
      ),
    ).toMatchObject({ status: 'confirmed', sentence: 'Deadline: 15 Jan 2027.' });
  });

  it('a low-confidence date is unknown, keeps the sentence and says why', () => {
    expect(postingDeadline({ ...base, description: 'Apply by 03/04/2027.' }, TZ)).toEqual({
      status: 'unknown',
      deadline_at: null,
      sentence: 'Apply by 03/04/2027.',
      note: 'numeric date could be day/month or month/day',
    });
  });

  it('never produces expected, and nothing found keeps the adapter sentence', () => {
    const d = postingDeadline({ ...base, deadline_text: 'Deadline: see website.' }, TZ);
    expect(d).toEqual({
      status: 'unknown',
      deadline_at: null,
      sentence: 'Deadline: see website.',
      note: null,
    });
  });

  it('infers the year from the posting date, not from today', () => {
    const d = postingDeadline(
      { ...base, posted_at: '2027-02-01T00:00:00.000Z', description: 'Apply by March 10.' },
      TZ,
    );
    expect(day(d.deadline_at)).toBe('2027-03-10');
  });
});

describe('deadlines and scoring in the database', () => {
  let t: ReturnType<typeof tempDb>;
  const rules = compileRules(parseRules(read('seeds/rules.json')));
  const profile = profileFromSettings(DEFAULT_SETTINGS);

  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  function add(title: string, description: string, type: 'internship' | 'program' = 'internship') {
    const src = insertSource(
      t.db,
      { kind: 'ashby', name: `Board ${title}`, access_method: 'api' },
      NOW,
    );
    return upsertOpportunity(
      t.db,
      {
        dedupe_key: `acme|${title}|`,
        source_id: src.id,
        org: 'Acme',
        title,
        opportunity_type: type,
        url: `https://acme.test/${encodeURIComponent(title)}`,
        description,
        posted_at: '2026-10-10T09:00:00.000Z',
      },
      NOW,
    ).opportunity.id;
  }

  it('extracts deadlines after a scan and flags doubtful ones in the eligibility notes', () => {
    const sure = add('Machine Learning Intern', 'Python, PyTorch. Apply by 30 November 2026.');
    const rolling = add('Backend Intern', 'Python. Applications reviewed on a rolling basis.');
    const doubtful = add('Data Science Intern', 'Python. Apply by 03/04/2027.');
    const r = extractDeadlines(t.db, TZ);
    expect(r).toEqual({ checked: 3, confirmed: 1, rolling: 1, doubtful: 1 });
    rescoreAll(t.db, rules, profile, NOW);

    expect(getOpportunityDetail(t.db, sure)).toMatchObject({
      deadline_status: 'confirmed',
      deadline_at: '2026-11-30T22:59:59.999Z',
      deadline_text: 'Apply by 30 November 2026.',
    });
    expect(getOpportunityDetail(t.db, rolling)).toMatchObject({
      deadline_status: 'rolling',
      deadline_at: null,
    });
    const d = getOpportunityDetail(t.db, doubtful)!;
    expect(d).toMatchObject({ deadline_status: 'unknown', deadline_at: null });
    expect(d.eligibility_notes).toContain(
      'Deadline: “Apply by 03/04/2027.” could not be read with confidence (numeric date could be day/month or month/day). Check the deadline',
    );
    // Idempotent.
    expect(extractDeadlines(t.db, TZ)).toEqual(r);
  });

  it('program postings are not scored', () => {
    const id = add('Google Summer of Code contributor', 'Open source program.', 'program');
    const r = rescoreAll(t.db, rules, profile, NOW);
    expect(r).toMatchObject({ scored: 0, programs: 1 });
    expect(getOpportunityDetail(t.db, id)).toMatchObject({
      score: null,
      verdict: null,
      breakdown: null,
    });
  });
});

describe('programs watchlist', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  const rows = () =>
    t.db.prepare('SELECT * FROM programs ORDER BY id').all() as {
      id: number;
      name: string;
      url: string | null;
      deadline_status: string;
      status: string;
      expected_open_at: string | null;
      expected_deadline_at: string | null;
      notes: string;
      source_id: number | null;
    }[];

  it('seeds the eight programs; last-cycle dates are expected and labelled unverified', () => {
    expect(programs.map((p) => p.name)).toEqual([
      'IAESTE Tunisia',
      'MBZUAI UGRIP',
      'KAUST VSRP',
      'Google Summer of Code',
      'Erasmus+ International Credit Mobility',
      'InstaDeep Tunis PFE',
      'Hugging Face summer 2027 internships',
      'Entrelacs',
    ]);
    expect(syncSeedPrograms(t.db, programs, TZ, NOW)).toEqual({
      inserted: 8,
      updated: 0,
      watched: 5,
    });
    const byName = Object.fromEntries(rows().map((r) => [r.name, r]));
    expect(rows().some((r) => r.deadline_status === 'confirmed')).toBe(false);
    const gsoc = byName['Google Summer of Code']!;
    expect([day(gsoc.expected_open_at), day(gsoc.expected_deadline_at)]).toEqual([
      '2027-03-16',
      '2027-03-31',
    ]);
    expect(gsoc.notes.startsWith(`Dates ${EXPECTED_LABEL}.`)).toBe(true);
    expect(day(byName['MBZUAI UGRIP']!.expected_deadline_at)).toBe('2027-02-28');
    expect(byName['MBZUAI UGRIP']!.url).toBeNull();
    expect(byName['KAUST VSRP']!.deadline_status).toBe('rolling');
    expect(byName['Entrelacs']!.source_id).toBeNull();
    // Watched pages are sources of kind 'page'; GSoC watches its timeline page.
    const pages = t.db
      .prepare("SELECT name, url FROM sources WHERE kind = 'page' ORDER BY id")
      .all();
    expect(pages).toContainEqual({
      name: 'Google Summer of Code (program page)',
      url: 'https://developers.google.com/open-source/gsoc/timeline',
    });
  });

  it('re-sync keeps the user status and confirmed dates, and does not duplicate', () => {
    syncSeedPrograms(t.db, programs, TZ, NOW);
    t.db.prepare("UPDATE programs SET status = 'applied' WHERE name = 'KAUST VSRP'").run();
    t.db
      .prepare(
        "UPDATE programs SET deadline_status = 'confirmed', expected_deadline_at = '2027-02-20T22:59:59.999Z' WHERE name = 'MBZUAI UGRIP'",
      )
      .run();
    expect(syncSeedPrograms(t.db, programs, TZ, NOW)).toMatchObject({ inserted: 0, updated: 8 });
    const byName = Object.fromEntries(rows().map((r) => [r.name, r]));
    expect(byName['KAUST VSRP']!.status).toBe('applied');
    expect(byName['MBZUAI UGRIP']!.expected_deadline_at).toBe('2027-02-20T22:59:59.999Z');
    expect(t.db.prepare("SELECT COUNT(*) FROM sources WHERE kind = 'page'").pluck().get()).toBe(5);
  });

  it('a program added after its "opens soon" day still gets it once, before the window opens', () => {
    syncSeedPrograms(t.db, programs, TZ, NOW);
    syncReminders(t.db, new Date('2026-10-19T08:00:00.000Z'), TZ);
    const hf = t.db
      .prepare(
        `SELECT r.kind, r.due_at FROM reminders r JOIN programs p ON p.id = r.target_id
          WHERE r.target_type = 'program' AND p.name LIKE 'Hugging Face%'`,
      )
      .all() as { kind: string; due_at: string }[];
    expect(hf.map((r) => [r.kind, day(r.due_at)])).toEqual([['opens_soon', '2026-10-18']]);
    // After the window opened (Nov 1), a fresh plan does not announce it any more.
    t.db.prepare('DELETE FROM reminders').run();
    syncReminders(t.db, new Date('2026-11-02T08:00:00.000Z'), TZ);
    expect(
      t.db
        .prepare(
          "SELECT COUNT(*) FROM reminders WHERE kind = 'opens_soon' AND due_at < '2026-11-01'",
        )
        .pluck()
        .get(),
    ).toBe(0);
  });

  it('rejects expected dates on a program that is not marked expected', () => {
    const bad: SeedProgram = { ...programs[2]!, expected_deadline: '2027-01-01' };
    expect(() => parseSeedPrograms({ version: 1, programs: [bad] })).toThrow(/expected/);
  });

  it('plans "window should open soon" 14 days ahead plus deadline reminders', () => {
    syncSeedPrograms(t.db, programs, TZ, NOW);
    syncReminders(t.db, NOW, TZ);
    const plan = t.db
      .prepare(
        `SELECT p.name, r.kind, r.due_at FROM reminders r JOIN programs p ON p.id = r.target_id
          WHERE r.target_type = 'program' ORDER BY r.due_at`,
      )
      .all() as { name: string; kind: string; due_at: string }[];
    const of = (name: string) =>
      plan.filter((r) => r.name === name).map((r) => [r.kind, day(r.due_at)]);
    expect(of('IAESTE Tunisia')).toEqual([
      ['opens_soon', '2026-11-17'],
      ['deadline_t30', '2027-01-29'],
      ['deadline_t14', '2027-02-14'],
      ['deadline_t7', '2027-02-21'],
      ['deadline_t2', '2027-02-26'],
      ['deadline_t0', '2027-02-28'],
    ]);
    // InstaDeep's window (Nov 1) is close: T-30 already passed on Oct 2, so the most recent
    // past offset fires once as a catch-up, then T-14, T-7, T-2, T-0.
    expect(of('InstaDeep Tunis PFE').map(([k]) => k)).toEqual([
      'deadline_t30',
      'deadline_t14',
      'deadline_t7',
      'deadline_t2',
      'deadline_t0',
    ]);
    expect(of('KAUST VSRP')).toEqual([]);
    expect(of('Hugging Face summer 2027 internships')).toEqual([['opens_soon', '2026-10-18']]);
  });
});
