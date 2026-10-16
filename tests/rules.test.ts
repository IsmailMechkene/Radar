import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { getOpportunityDetail, upsertOpportunity } from '../src/core/db/opportunities';
import { insertSource } from '../src/core/db/sources';
import { loadSampleData } from '../src/core/dev/sample';
import {
  compileRules,
  fold,
  scoreOpportunity,
  type ScoringInput,
  type ScoringProfile,
} from '../src/core/rules/engine';
import { profileFromSettings, SCORING_SETTING_KEYS } from '../src/core/rules/profile';
import { rescoreAll } from '../src/core/rules/rescore';
import { parseRules, type Rules } from '../src/core/rules/schema';
import { DEFAULT_SETTINGS } from '../src/core/settings/schema';
import { tempDb } from './helpers';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const read = (rel: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', rel), 'utf8')) as unknown;
const rulesRaw = read('seeds/rules.json') as Rules;
const rules = parseRules(rulesRaw);
const compiled = compileRules(rules);
const profile: ScoringProfile = profileFromSettings(DEFAULT_SETTINGS);

interface LabelledCase extends Omit<ScoringInput, 'posted_at' | 'first_seen_at' | 'deadline_at'> {
  id: string;
  expected: 'apply' | 'maybe' | 'needs_review' | 'skip';
  posted_days_ago: number;
}
const labelled = (read('fixtures/rules/labelled-postings.json') as { cases: LabelledCase[] }).cases;

function input(c: LabelledCase): ScoringInput {
  const posted = new Date(NOW.getTime() - c.posted_days_ago * 86_400_000).toISOString();
  return { ...c, posted_at: posted, first_seen_at: posted, deadline_at: null };
}
const byId = (id: string) => labelled.find((c) => c.id === id)!;

describe('rules file', () => {
  it('seeds/rules.json is valid and thresholds follow SPEC', () => {
    expect(rules.thresholds).toEqual({ apply: 65, maybe: 40 });
    expect(() => parseRules({ ...rulesRaw, thresholds: { apply: 30, maybe: 60 } })).toThrow();
    expect(() => parseRules({ ...rulesRaw, extra: 1 })).toThrow();
  });
});

describe('labelled postings (SPEC M4)', () => {
  it('has at least 30 labelled postings covering every verdict', () => {
    expect(labelled.length).toBeGreaterThanOrEqual(30);
    expect(new Set(labelled.map((c) => c.expected))).toEqual(
      new Set(['apply', 'maybe', 'needs_review', 'skip']),
    );
  });

  it.each(labelled.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const r = scoreOpportunity(input(c), compiled, profile, NOW);
    expect(r.verdict).toBe(c.expected);
  });
});

describe('scoring details', () => {
  it('signals add up to the score and the summary explains it', () => {
    const r = scoreOpportunity(input(byId('ml-intern-paris-visa')), compiled, profile, NOW);
    expect(r.breakdown.signals.reduce((n, s) => n + s.points, 0)).toBe(r.score);
    expect(r.breakdown.signals.map((s) => s.id)).toEqual([
      'role',
      'student',
      'stack',
      'location',
      'visa',
      'watchlist',
      'fresh',
      'deadline',
    ]);
    expect(r.breakdown.summary).toBe('AI/ML title, internship, Python + PyTorch, remote');
    expect(r.breakdown.signals.find((s) => s.id === 'visa')?.detail).toBe('“We sponsor”');
  });

  it('penalties are capped at 40 in total', () => {
    const r = scoreOpportunity(
      {
        ...input(byId('senior-ml-engineer')),
        description: 'Fluent German required. 7+ years of experience.',
        language: 'other',
      },
      compiled,
      { ...profile, remotePreference: 'remote_only' },
      NOW,
    );
    const penalty = r.breakdown.signals
      .filter((s) => s.points < 0)
      .reduce((n, s) => n + s.points, 0);
    expect(penalty).toBe(-40);
  });

  it('writes eligibility flags instead of hiding postings', () => {
    const gpa = scoreOpportunity(input(byId('ugrip-gpa')), compiled, profile, NOW);
    expect(gpa.eligibilityNotes).toBe(
      'GPA requirement: “CGPA of 3.5/4” requested. Your 15/20 is unverified',
    );
    const auth = scoreOpportunity(input(byId('authorized-to-work-us')), compiled, profile, NOW);
    expect(auth.eligibilityNotes).toBe(
      'Work authorization: “must be authorized to work” may exclude you',
    );
    const pfe = scoreOpportunity(input(byId('pfe-rl-tunis-watchlist')), compiled, profile, NOW);
    expect(pfe.eligibilityNotes).toBe(
      'School agreement: “Convention de stage” mentioned. Check with your school before applying',
    );
    expect(pfe.verdict).toBe('apply'); // an agreement note is information, not a blocker
    const lock = scoreOpportunity(input(byId('us-persons-only')), compiled, profile, NOW);
    expect(lock.breakdown.signals.find((s) => s.id === 'filter')?.detail).toBe(
      'Work authorization: “US persons only”',
    );
  });

  it('search mode "all" keeps regular jobs; "internships" skips them', () => {
    const job = input(byId('fulltime-backend-not-internship'));
    expect(scoreOpportunity(job, compiled, profile, NOW).verdict).toBe('skip');
    const all = scoreOpportunity(job, compiled, { ...profile, searchMode: 'all' }, NOW);
    expect(all.verdict).toBe('maybe');
    expect(all.breakdown.signals.some((s) => s.id === 'filter')).toBe(false);
  });

  it('student titles may contain "manager" but never "senior"', () => {
    expect(
      scoreOpportunity(input(byId('product-manager-intern-allowed')), compiled, profile, NOW)
        .verdict,
    ).toBe('maybe');
    const seniorIntern = { ...input(byId('ml-intern-paris-visa')), title: 'Senior ML Intern' };
    expect(scoreOpportunity(seniorIntern, compiled, profile, NOW).verdict).toBe('skip');
  });

  it('matches accents both ways and on word boundaries', () => {
    expect(fold('Développeur Back-End')).toBe('developpeur back-end');
    const fr = { ...input(byId('software-intern-sfax')), title: 'Developpeur backend stagiaire' };
    expect(
      scoreOpportunity(fr, compiled, profile, NOW).breakdown.signals[0]!.points,
    ).toBeGreaterThan(0);
    const internal = {
      ...input(byId('fulltime-backend-not-internship')),
      title: 'Internal Tools Specialist',
    };
    expect(scoreOpportunity(internal, compiled, profile, NOW).breakdown.signals[0]!.points).toBe(0);
  });

  it('a deadline more than 14 days away adds points; a near one does not', () => {
    const base = input(byId('frontend-intern-paris'));
    const later = scoreOpportunity(
      { ...base, deadline_at: new Date(NOW.getTime() + 30 * 86_400_000).toISOString() },
      compiled,
      profile,
      NOW,
    );
    const soon = scoreOpportunity(
      { ...base, deadline_at: new Date(NOW.getTime() + 5 * 86_400_000).toISOString() },
      compiled,
      profile,
      NOW,
    );
    expect(later.score - soon.score).toBe(5);
  });

  it('settings keys that change scores', () => {
    expect(SCORING_SETTING_KEYS).toContain('targetRegions');
    expect(profileFromSettings(DEFAULT_SETTINGS).gradeRaw).toBe('15/20');
  });
});

describe('rescoreAll', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  function store(c: LabelledCase): number {
    const src = insertSource(
      t.db,
      { kind: 'ashby', name: `Board ${c.id}`, access_method: 'api' },
      NOW,
    );
    const i = input(c);
    return upsertOpportunity(
      t.db,
      {
        dedupe_key: c.id,
        source_id: src.id,
        org: i.org,
        title: i.title,
        location: i.location,
        remote_type: i.remote_type,
        opportunity_type: i.opportunity_type,
        language: i.language,
        url: `https://example.com/${c.id}`,
        description: i.description,
        posted_at: i.posted_at,
      },
      NOW,
    ).opportunity.id;
  }

  it('changing a weight changes the verdict after re-score (SPEC M4)', () => {
    const id = store(byId('data-engineer-intern-tunis'));
    expect(rescoreAll(t.db, compiled, profile, NOW).byVerdict.maybe).toBe(1);
    expect(getOpportunityDetail(t.db, id)!.verdict).toBe('maybe');

    const heavier: Rules = structuredClone(rules);
    heavier.role.groups.find((g) => g.label === 'Engineering title')!.points = 30;
    rescoreAll(t.db, compileRules(heavier), profile, NOW);
    const after = getOpportunityDetail(t.db, id)!;
    expect(after.verdict).toBe('apply');
    expect(after.breakdown?.signals[0]).toMatchObject({ id: 'role', points: 30 });
  });

  it('stores flags, is idempotent and leaves development sample rows alone', () => {
    // Stored as an internship: program postings are left unscored by rescoreAll.
    const id = store({ ...byId('ugrip-gpa'), opportunity_type: 'internship' });
    loadSampleData(t.db, read('fixtures/sample-opportunities.json'), NOW);
    const first = rescoreAll(t.db, compiled, profile, NOW);
    expect(first.scored).toBe(1);
    const row = getOpportunityDetail(t.db, id)!;
    expect(row.verdict).toBe('needs_review');
    expect(row.eligibility_notes).toMatch(/^GPA requirement/);
    expect(rescoreAll(t.db, compiled, profile, NOW)).toEqual(first);
    const sampleScores = t.db
      .prepare(
        "SELECT o.score FROM opportunities o JOIN sources s ON s.id = o.source_id WHERE s.kind = 'sample' ORDER BY o.score DESC LIMIT 1",
      )
      .pluck()
      .get();
    expect(sampleScores).toBe(92); // the fixture's own score
  });
});
