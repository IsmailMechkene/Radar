// Rules page: which parts of the rules are editable and how. Pure; the engine scores the preview.
import {
  compileRules,
  scoreOpportunity,
  type ScoreResult,
  type ScoringProfile,
} from '../../../core/rules/engine';
import type { Rules } from '../../../core/rules/schema';
import type { PreviewItem } from '../../../core/rules/store';

/** Where a weight is shown: the role match, a bonus, or a penalty (stored negative). */
export type WeightSection = 'role' | 'bonus' | 'penalty';

export interface WeightDef {
  id: string;
  section: WeightSection;
  label: string;
  description: string;
  /** The keyword list this weight applies to (shown and edited under it). */
  list?: string;
  min: number;
  max: number;
  get: (r: Rules) => number;
  set: (r: Rules, v: number) => Rules;
}

/** Copy-on-write helpers keep the draft immutable (React state). */
const clone = (r: Rules): Rules => structuredClone(r);

export const WEIGHTS: WeightDef[] = [
  {
    id: 'roles',
    section: 'role',
    label: 'Your roles of interest',
    description: 'Title matches a role from Settings',
    min: 0,
    max: 40,
    get: (r) => r.role.rolesOfInterestPoints,
    set: (r, v) => ({ ...clone(r), role: { ...r.role, rolesOfInterestPoints: v } }),
  },
  {
    id: 'internship',
    section: 'bonus',
    label: 'Internship',
    description: 'Intern, stage, Werkstudent, summer',
    min: 0,
    max: 30,
    get: (r) => r.student.typePoints.internship ?? 0,
    set: (r, v) => ({
      ...clone(r),
      student: { ...r.student, typePoints: { ...r.student.typePoints, internship: v } },
    }),
  },
  {
    id: 'pfe',
    section: 'bonus',
    label: 'PFE / end-of-studies',
    description: 'Projet de fin d’études, master thesis',
    min: 0,
    max: 30,
    get: (r) => r.student.typePoints.pfe ?? 0,
    set: (r, v) => ({
      ...clone(r),
      student: { ...r.student, typePoints: { ...r.student.typePoints, pfe: v } },
    }),
  },
  {
    id: 'junior',
    section: 'bonus',
    label: 'Junior role',
    description: 'Junior, graduate, entry level',
    min: 0,
    max: 30,
    get: (r) => r.student.typePoints.junior ?? 0,
    set: (r, v) => ({
      ...clone(r),
      student: { ...r.student, typePoints: { ...r.student.typePoints, junior: v } },
    }),
  },
  {
    id: 'stack',
    section: 'bonus',
    list: 'stack',
    label: 'Stack match, each',
    description: 'Per stack keyword found (capped)',
    min: 0,
    max: 10,
    get: (r) => r.stack.pointsEach,
    set: (r, v) => ({ ...clone(r), stack: { ...r.stack, pointsEach: v } }),
  },
  {
    id: 'region',
    section: 'bonus',
    label: 'Target region',
    description: 'Location in a region from Settings',
    min: 0,
    max: 10,
    get: (r) => r.location.regionPoints,
    set: (r, v) => ({ ...clone(r), location: { ...r.location, regionPoints: v } }),
  },
  {
    id: 'visa',
    section: 'bonus',
    label: 'Visa friendly',
    description: 'Sponsorship or relocation mentioned',
    min: 0,
    max: 20,
    get: (r) => r.visa.points,
    set: (r, v) => ({ ...clone(r), visa: { ...r.visa, points: v } }),
  },
  {
    id: 'watchlist',
    section: 'bonus',
    list: 'watchlist',
    label: 'Watchlist company',
    description: 'Posting from a company on your list',
    min: 0,
    max: 20,
    get: (r) => r.watchlist.points,
    set: (r, v) => ({ ...clone(r), watchlist: { ...r.watchlist, points: v } }),
  },
  {
    id: 'fresh',
    section: 'bonus',
    label: 'Fresh posting',
    description: 'Seen in the last 14 days',
    min: 0,
    max: 10,
    get: (r) => r.fresh.points,
    set: (r, v) => ({ ...clone(r), fresh: { ...r.fresh, points: v } }),
  },
  {
    id: 'deadline',
    section: 'bonus',
    label: 'Deadline far enough',
    description: 'More than 14 days to apply',
    min: 0,
    max: 10,
    get: (r) => r.deadline.points,
    set: (r, v) => ({ ...clone(r), deadline: { ...r.deadline, points: v } }),
  },
  {
    id: 'senior',
    section: 'penalty',
    label: 'Senior wording',
    description: 'Senior, staff, lead, principal',
    min: -50,
    max: 0,
    get: (r) => r.penalties.seniorTitle.points,
    set: (r, v) => ({
      ...clone(r),
      penalties: { ...r.penalties, seniorTitle: { ...r.penalties.seniorTitle, points: v } },
    }),
  },
  {
    id: 'experience',
    section: 'penalty',
    label: 'Years of experience',
    description: '5+ years required',
    min: -40,
    max: 0,
    get: (r) => r.penalties.experience.points,
    set: (r, v) => ({
      ...clone(r),
      penalties: { ...r.penalties, experience: { ...r.penalties.experience, points: v } },
    }),
  },
  {
    id: 'language',
    section: 'penalty',
    label: 'Language barrier',
    description: 'Requires a language you don’t speak',
    min: -50,
    max: 0,
    get: (r) => r.penalties.language.points,
    set: (r, v) => ({
      ...clone(r),
      penalties: { ...r.penalties, language: { ...r.penalties.language, points: v } },
    }),
  },
  {
    id: 'onsite',
    section: 'penalty',
    label: 'On-site when you want remote',
    description: 'Only with a remote-only preference',
    min: -40,
    max: 0,
    get: (r) => r.penalties.notRemote.points,
    set: (r, v) => ({ ...clone(r), penalties: { ...r.penalties, notRemote: { points: v } } }),
  },
];

export const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export interface ListDef {
  id: string;
  /** Section heading where the list stands alone (the excluded title words). */
  title: string;
  description: string;
  noun: string;
  tone: 'default' | 'danger';
  get: (r: Rules) => string[];
  set: (r: Rules, items: string[]) => Rules;
}

export function roleGroupList(index: number): ListDef {
  return {
    id: `role-${index}`,
    title: '',
    description: '',
    noun: 'keyword',
    tone: 'default',
    get: (r) => r.role.groups[index]?.terms ?? [],
    set: (r, items) => {
      const next = clone(r);
      next.role.groups[index]!.terms = items;
      return next;
    },
  };
}

export const LISTS: ListDef[] = [
  {
    id: 'excludes',
    title: 'Exclude from titles',
    description: 'A title with these words is skipped, unless it is an internship or PFE',
    noun: 'word',
    tone: 'danger',
    get: (r) => r.hardFilters.titleExcludes,
    set: (r, items) => ({ ...clone(r), hardFilters: { ...r.hardFilters, titleExcludes: items } }),
  },
  {
    id: 'stack',
    title: 'Stack keywords',
    description: 'Each one found in a posting adds the stack points',
    noun: 'keyword',
    tone: 'default',
    get: (r) => r.stack.terms,
    set: (r, items) => ({ ...clone(r), stack: { ...r.stack, terms: items } }),
  },
  {
    id: 'watchlist',
    title: 'Watchlist companies',
    description: 'Postings from these organizations get the watchlist points',
    noun: 'company',
    tone: 'default',
    get: (r) => r.watchlist.orgs,
    set: (r, items) => ({ ...clone(r), watchlist: { ...r.watchlist, orgs: items } }),
  },
];

export const weightsIn = (section: WeightSection) => WEIGHTS.filter((w) => w.section === section);
export const listById = (id: string) => LISTS.find((l) => l.id === id);

/** Group points (each role group is a weight too). */
export function setGroupPoints(r: Rules, index: number, v: number): Rules {
  const next = clone(r);
  next.role.groups[index]!.points = v;
  return next;
}

/** Thresholds keep Maybe at or below Apply. */
export function setThreshold(r: Rules, which: 'maybe' | 'apply', v: number): Rules {
  const t = { ...r.thresholds, [which]: v };
  if (which === 'maybe' && t.maybe > t.apply) t.apply = t.maybe;
  if (which === 'apply' && t.apply < t.maybe) t.maybe = t.apply;
  return { ...clone(r), thresholds: t };
}

/** Lists cannot be emptied (the rules schema needs at least one term). */
export const canRemove = (items: readonly string[]) => items.length > 1;

export function sameRules(a: Rules, b: Rules): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PreviewRow {
  item: PreviewItem;
  result: ScoreResult;
  delta: number | null;
}

/** Scores the preview postings with draft rules, exactly as the engine will after saving. */
export function scorePreview(
  items: readonly PreviewItem[],
  rules: Rules,
  profile: ScoringProfile,
  now: Date,
): PreviewRow[] {
  const compiled = compileRules(rules);
  return items.map((item) => {
    const result = scoreOpportunity(item, compiled, profile, now);
    return { item, result, delta: item.score === null ? null : result.score - item.score };
  });
}

/**
 * One line under a preview row: why it got its verdict. A hard filter ("Not an internship") or the
 * eligibility flag behind Needs review wins; a low score says so; otherwise the strongest signals.
 */
export function verdictReason(result: ScoreResult, maybeFrom: number): string {
  if (result.verdict === 'skip') {
    const filter = result.breakdown.signals.find((s) => s.id === 'filter');
    if (filter) return filter.detail.split('; ')[0]!;
    return `Under Maybe (${maybeFrom}) · ${result.breakdown.summary}`;
  }
  if (result.verdict === 'needs_review' && result.eligibilityNotes) {
    return result.eligibilityNotes.split('\n')[0]!.split(':')[0]!.trim();
  }
  return result.breakdown.summary;
}

/** "Re-scored 377: 6 apply, 2 maybe, 0 needs review, 369 skip" */
export function rescoreSummary(
  r: { scored: number; byVerdict: Record<string, number> } | null,
): string {
  if (!r) return 'Nothing to re-score';
  const v = r.byVerdict;
  return `Re-scored ${r.scored}: ${v['apply'] ?? 0} apply, ${v['maybe'] ?? 0} maybe, ${v['needs_review'] ?? 0} needs review, ${v['skip'] ?? 0} skip`;
}
