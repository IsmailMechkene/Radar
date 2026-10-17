import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { upsertOpportunity } from '../src/core/db/opportunities';
import { insertSource } from '../src/core/db/sources';
import { compileRules } from '../src/core/rules/engine';
import { profileFromSettings } from '../src/core/rules/profile';
import { rescoreAll } from '../src/core/rules/rescore';
import { parseRules } from '../src/core/rules/schema';
import {
  effectiveRules,
  getUserRules,
  previewItems,
  resetUserRules,
  saveUserRules,
} from '../src/core/rules/store';
import { DEFAULT_SETTINGS } from '../src/core/settings/schema';
import {
  LISTS,
  rescoreSummary,
  sameRules,
  scorePreview,
  setGroupPoints,
  setThreshold,
  verdictReason,
  WEIGHTS,
  weightsIn,
} from '../src/renderer/src/lib/rules';
import { tempDb } from './helpers';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const defaults = parseRules(
  JSON.parse(readFileSync(join(__dirname, '..', 'seeds', 'rules.json'), 'utf8')),
);
const profile = profileFromSettings(DEFAULT_SETTINGS);

describe('stored rules', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('defaults until you save; reset goes back', () => {
    expect(effectiveRules(t.db, defaults)).toMatchObject({ custom: false, error: null });
    const edited = setThreshold(defaults, 'apply', 70);
    saveUserRules(t.db, edited, NOW);
    expect(effectiveRules(t.db, defaults)).toMatchObject({
      custom: true,
      rules: { thresholds: { apply: 70 } },
    });
    expect(resetUserRules(t.db)).toBe(true);
    expect(effectiveRules(t.db, defaults).custom).toBe(false);
  });

  it('refuses invalid rules and reports a corrupted saved version instead of using it', () => {
    expect(() =>
      saveUserRules(t.db, { ...defaults, thresholds: { apply: 30, maybe: 60 } }, NOW),
    ).toThrow(/maybe threshold/);
    expect(() =>
      saveUserRules(t.db, { ...defaults, stack: { ...defaults.stack, terms: [] } }, NOW),
    ).toThrow();
    t.db
      .prepare(
        'INSERT INTO user_rules (id, rules_json, updated_at) VALUES (1, \'{"version":2}\', ?)',
      )
      .run(NOW.toISOString());
    expect(getUserRules(t.db)).toMatchObject({
      error: expect.stringMatching(/invalid, so the default rules are used/),
    });
    expect(effectiveRules(t.db, defaults)).toMatchObject({
      custom: false,
      error: expect.any(String),
    });
  });

  it('preview picks scored postings across verdicts, never programs', () => {
    const src = insertSource(t.db, { kind: 'ashby', name: 'B', access_method: 'api' }, NOW);
    const add = (title: string, type: 'internship' | 'fulltime' | 'program') =>
      upsertOpportunity(
        t.db,
        {
          dedupe_key: `x|${title}|`,
          source_id: src.id,
          org: 'Mistral AI',
          title,
          opportunity_type: type,
          url: `https://x.test/${encodeURIComponent(title)}`,
          description: 'Python, PyTorch',
        },
        NOW,
      );
    add('Machine Learning Intern', 'internship');
    add('Senior Backend Engineer', 'fulltime');
    add('Sales Intern', 'internship');
    add('Google Summer of Code', 'program');
    rescoreAll(t.db, compileRules(defaults), profile, NOW);
    const items = previewItems(t.db);
    expect(items.map((i) => i.title).sort()).toEqual([
      'Machine Learning Intern',
      'Sales Intern',
      'Senior Backend Engineer',
    ]);
    // The preview scores exactly as the engine does after saving.
    const rows = scorePreview(items, defaults, profile, NOW);
    for (const r of rows) expect(r.result.score).toBe(r.item.score);
    expect(rows.every((r) => r.delta === 0)).toBe(true);
    // Each row says why: a hard filter for a Skip, the strongest signals otherwise.
    const senior = rows.find((r) => r.item.title === 'Senior Backend Engineer')!;
    expect(senior.result.verdict).toBe('skip');
    expect(verdictReason(senior.result, 40)).toMatch(/^(Excluded title word|Not an internship)/);
    const ml = rows.find((r) => r.item.title === 'Machine Learning Intern')!;
    expect(verdictReason(ml.result, 40)).toBe(ml.result.breakdown.summary);
    const harsher = scorePreview(items, setGroupPoints(defaults, 0, 0), profile, NOW);
    expect(harsher.find((r) => r.item.title === 'Machine Learning Intern')!.delta).toBeLessThan(0);
  });
});

describe('rules page edits', () => {
  it('weights are grouped: role, bonuses, penalties (stored negative), lists attached', () => {
    expect(weightsIn('role').map((w) => w.id)).toEqual(['roles']);
    expect(weightsIn('penalty').every((w) => w.max === 0 && w.min < 0)).toBe(true);
    expect(weightsIn('bonus').every((w) => w.min === 0)).toBe(true);
    expect(WEIGHTS.filter((w) => w.list).map((w) => [w.id, w.list])).toEqual([
      ['stack', 'stack'],
      ['watchlist', 'watchlist'],
    ]);
    expect(weightsIn('role').length + weightsIn('bonus').length + weightsIn('penalty').length).toBe(
      WEIGHTS.length,
    );
  });

  it('every weight reads and writes its own value without touching the saved rules', () => {
    for (const w of WEIGHTS) {
      const v = w.get(defaults);
      const next = w.set(defaults, w.min === 0 ? Math.min(w.max, v + 1) : Math.max(w.min, v - 1));
      expect(w.get(next)).not.toBe(v);
      expect(w.get(defaults)).toBe(v); // copy on write
      expect(() => parseRules(next)).not.toThrow();
    }
  });

  it('thresholds keep Maybe at or below Apply; lists and comparison', () => {
    expect(setThreshold(defaults, 'maybe', 80).thresholds).toEqual({ maybe: 80, apply: 80 });
    expect(setThreshold(defaults, 'apply', 30).thresholds).toEqual({ maybe: 30, apply: 30 });
    const watch = LISTS.find((l) => l.id === 'watchlist')!;
    const added = watch.set(defaults, [...watch.get(defaults), 'ElevenLabs']);
    expect(watch.get(added)).toContain('ElevenLabs');
    expect(sameRules(defaults, added)).toBe(false);
    expect(sameRules(defaults, structuredClone(defaults))).toBe(true);
    expect(
      rescoreSummary({ scored: 3, byVerdict: { apply: 1, maybe: 0, needs_review: 0, skip: 2 } }),
    ).toBe('Re-scored 3: 1 apply, 0 maybe, 0 needs review, 2 skip');
  });
});
