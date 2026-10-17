// Rules engine (SPEC section 6): plain, explainable rules; no LLM. Pure: pass rules, profile and
// clock. Every point is a named signal so the drawer can show exactly why a posting scored.
import { wordRegExp } from '../adapters/normalize';
import type { OpportunityRow, ScoreBreakdown, ScoreSignal } from '../db/schemas';
import type { Rules } from './schema';

export type ScoringInput = Pick<
  OpportunityRow,
  | 'org'
  | 'title'
  | 'location'
  | 'remote_type'
  | 'opportunity_type'
  | 'language'
  | 'description'
  | 'posted_at'
  | 'first_seen_at'
  | 'deadline_at'
>;

export interface ScoringProfile {
  searchMode: 'internships' | 'all';
  rolesOfInterest: readonly string[];
  targetRegions: readonly string[];
  remotePreference: 'onsite_preferred' | 'remote_preferred' | 'onsite_only' | 'remote_only' | 'any';
  /** As the user wrote it (e.g. "15/20"); quoted in GPA flags, never converted. */
  gradeRaw: string;
}

export interface ScoreResult {
  score: number;
  verdict: 'apply' | 'maybe' | 'needs_review' | 'skip';
  breakdown: ScoreBreakdown;
  /** One flag per line, "Label: detail" (drawer format). Null when nothing to flag. */
  eligibilityNotes: string | null;
}

/** Lowercase, accents removed, typographic apostrophes straightened: "Développeur" -> "developpeur". */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * The original text behind `folded[index, index + length)`. fold() usually keeps the length, but
 * NFKD expands some characters ("…" -> "...", "ﬁ" -> "fi"), which shifts every later position; then
 * each original character is folded on its own to map positions back.
 */
export function originalSpan(text: string, folded: string, index: number, length: number): string {
  if (folded.length === text.length) return text.slice(index, index + length);
  let f = 0;
  let start = -1;
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const next = f + fold(ch).length;
    if (start < 0 && next > index) start = i;
    if (start >= 0 && next >= index + length) return text.slice(start, i + ch.length);
    f = next;
    i += ch.length;
  }
  return start < 0 ? '' : text.slice(start);
}

interface Matcher {
  /** First match in `text` (original casing), or null. */
  find(text: string): string | null;
  /** Every distinct term that occurs in `text`, in list order (original casing). */
  all(text: string): string[];
}

function matcher(terms: readonly string[]): Matcher {
  const folded = terms.map(fold);
  const any = wordRegExp(folded);
  const each = folded.map((t) => wordRegExp([t]));
  const pick = (text: string, re: RegExp): string | null => {
    const folded = fold(text);
    const m = re.exec(folded);
    return m ? originalSpan(text, folded, m.index, m[0].length) : null;
  };
  return {
    find: (text) => pick(text, any),
    all: (text) => each.map((re) => pick(text, re)).filter((m): m is string => m !== null),
  };
}

const LANGUAGES: Record<string, string[]> = {
  german: ['german', 'deutsch', 'deutschkenntnisse', 'allemand'],
  dutch: ['dutch', 'nederlands', 'neerlandais'],
  spanish: ['spanish', 'espanol', 'espagnol'],
  italian: ['italian', 'italiano', 'italien'],
  portuguese: ['portuguese', 'portugais'],
  swedish: ['swedish', 'svenska'],
  danish: ['danish', 'dansk'],
  norwegian: ['norwegian', 'norsk'],
  finnish: ['finnish', 'suomi'],
  polish: ['polish', 'polski'],
  czech: ['czech'],
  japanese: ['japanese'],
  korean: ['korean'],
  mandarin: ['mandarin', 'chinese'],
  hebrew: ['hebrew'],
  turkish: ['turkish'],
  russian: ['russian'],
  english: ['english', 'anglais', 'englisch'],
  french: ['french', 'francais', 'franzosisch'],
  arabic: ['arabic', 'arabe'],
};
const REQUIREMENT =
  'fluent|fluency|native|proficien\\w*|business[ -]level|c1|c2|b2|required|mandatory|speaker|speaking|kenntnisse|courant|maitrise|verhandlungssicher|fliessend';

/** "fluent German", "German (C1) required", "Deutschkenntnisse", "Dutch speaker". */
function languageRequirement(text: string, spoken: readonly string[]): string | null {
  const ok = new Set(spoken.map(fold));
  const names = Object.entries(LANGUAGES)
    .filter(([lang]) => !ok.has(lang))
    .flatMap(([, aliases]) => aliases);
  if (!names.length) return null;
  const lang = `(?:${names.join('|')})`;
  const re = new RegExp(
    `(?<![\\p{L}])(?:deutschkenntnisse|${lang}(?![\\p{L}])[^.\\n]{0,40}?(?<![\\p{L}])(?:${REQUIREMENT})(?![\\p{L}])|(?:${REQUIREMENT})(?![\\p{L}])[^.\\n]{0,40}?(?<![\\p{L}])${lang}(?![\\p{L}]))`,
    'iu',
  );
  const folded = fold(text);
  const m = re.exec(folded);
  return m ? originalSpan(text, folded, m.index, m[0].length).trim() : null;
}

/** "GPA 3.5/4", "CGPA of 3.5 out of 4", "top 20% of class". Quoted, never converted. */
const GPA_RE =
  /(?<![\p{L}])(?:c?gpa|grade point average)(?![\p{L}])[^.\n]{0,30}?\d(?:[.,]\d+)?\s*(?:\/|out of|on)\s*\d+(?:[.,]\d+)?|(?<![\p{L}])top \d{1,2}\s?%(?: of (?:the |your )?class)?/iu;

const DAY_MS = 86_400_000;

export interface CompiledRules {
  rules: Rules;
  role: { label: string; points: number; m: Matcher }[];
  stack: Matcher;
  studentTerms: Matcher;
  regions: Map<string, Matcher>;
  visa: Matcher;
  watchlist: Set<string>;
  senior: Matcher;
  experience: Matcher;
  titleExcludes: Matcher;
  allowedInStudentTitles: Set<string>;
  lock: Matcher;
  ambiguous: Matcher;
  agreement: Matcher;
}

/** Builds the matchers once; reuse the result for every posting. */
export function compileRules(rules: Rules): CompiledRules {
  return {
    rules,
    role: [...rules.role.groups]
      .sort((a, b) => b.points - a.points)
      .map((g) => ({ label: g.label, points: g.points, m: matcher(g.terms) })),
    stack: matcher(rules.stack.terms),
    studentTerms: matcher(rules.student.terms),
    regions: new Map(Object.entries(rules.regions).map(([name, t]) => [fold(name), matcher(t)])),
    visa: matcher(rules.visa.terms),
    watchlist: new Set(rules.watchlist.orgs.map(fold)),
    senior: matcher(rules.penalties.seniorTitle.terms),
    experience: matcher(rules.penalties.experience.terms),
    titleExcludes: matcher(rules.hardFilters.titleExcludes),
    allowedInStudentTitles: new Set(rules.hardFilters.allowedInStudentTitles.map(fold)),
    lock: matcher(rules.eligibility.workAuthLock),
    ambiguous: matcher(rules.eligibility.workAuthAmbiguous),
    agreement: matcher(rules.eligibility.agreementTerms),
  };
}

const TYPE_LABEL: Record<ScoringInput['opportunity_type'], string> = {
  internship: 'Internship',
  pfe: 'PFE',
  program: 'Program',
  junior: 'Junior role',
  fulltime: 'Regular job',
};
const REMOTE_LABEL = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'on-site',
  unknown: 'workplace not stated',
};
const WORKPLACE_FIT: Record<ScoringProfile['remotePreference'], Record<string, number>> = {
  onsite_preferred: { onsite: 1, hybrid: 1, remote: 2 / 3, unknown: 0 },
  remote_preferred: { remote: 1, hybrid: 2 / 3, onsite: 0, unknown: 0 },
  onsite_only: { onsite: 1, hybrid: 1, remote: 0, unknown: 0 },
  remote_only: { remote: 1, hybrid: 0, onsite: 0, unknown: 0 },
  any: { remote: 1, hybrid: 1, onsite: 1, unknown: 1 },
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const quote = (s: string) => `“${s}”`;
const cap = (n: number, max: number) => Math.min(max, Math.max(0, n));

export function scoreOpportunity(
  o: ScoringInput,
  c: CompiledRules,
  profile: ScoringProfile,
  now: Date,
): ScoreResult {
  const r = c.rules;
  const title = o.title;
  const text = `${o.title}\n${o.description ?? ''}`;
  const signals: ScoreSignal[] = [];
  const summary: string[] = [];
  const notes: string[] = [];
  const skipReasons: string[] = [];
  let ambiguous = false;

  // --- Role (up to role.max) ---
  let rolePts = 0;
  let roleDetail = 'No role keyword in title';
  let roleLabel: string | null = null;
  for (const g of c.role) {
    const hit = g.m.find(title);
    if (hit) {
      rolePts = g.points;
      roleDetail = `${quote(hit)} in title`;
      roleLabel = g.label;
      break;
    }
  }
  for (const role of profile.rolesOfInterest) {
    const hit = matcher([role]).find(title);
    if (hit && r.role.rolesOfInterestPoints > rolePts) {
      rolePts = r.role.rolesOfInterestPoints;
      roleDetail = `Matches your role ${quote(role)}`;
      roleLabel = 'Your role';
      break;
    }
  }
  rolePts = cap(rolePts, r.role.max);
  signals.push({ id: 'role', label: 'Role match', detail: roleDetail, points: rolePts });
  if (roleLabel && rolePts) summary.push(roleLabel === 'Your role' ? 'Your role' : roleLabel);

  // --- Internship / student (up to student.max) ---
  const typePts = r.student.typePoints[o.opportunity_type] ?? 0;
  const term = c.studentTerms.find(text);
  const studentPts = cap(typePts + (term ? r.student.termPoints : 0), r.student.max);
  signals.push({
    id: 'student',
    label: 'Internship',
    detail: [TYPE_LABEL[o.opportunity_type], term && quote(term)].filter(Boolean).join(' · '),
    points: studentPts,
  });
  if (typePts && o.opportunity_type !== 'fulltime')
    summary.push(TYPE_LABEL[o.opportunity_type].toLowerCase());

  // --- Stack (up to stack.max) ---
  const stack = [...new Map(c.stack.all(text).map((s) => [fold(s), s])).values()];
  const stackPts = cap(stack.length * r.stack.pointsEach, r.stack.max);
  signals.push({
    id: 'stack',
    label: 'Stack match',
    detail: stack.length ? stack.slice(0, 5).join(', ') : 'None of your stack keywords',
    points: stackPts,
  });
  if (stack.length >= 2) summary.push(stack.slice(0, 2).join(' + '));

  // --- Location and workplace (up to location.max) ---
  const loc = o.location ?? '';
  let region: string | null = null;
  for (const name of profile.targetRegions) {
    const m = c.regions.get(fold(name)) ?? matcher([name]);
    if (m.find(loc) || (fold(name) === 'remote' && o.remote_type === 'remote')) {
      region = name;
      break;
    }
  }
  const fit = WORKPLACE_FIT[profile.remotePreference][o.remote_type] ?? 0;
  const langPts =
    o.language === 'en'
      ? r.location.languagePoints.en
      : o.language === 'fr'
        ? r.location.languagePoints.fr
        : 0;
  const locPts = cap(
    Math.round((region ? r.location.regionPoints : 0) + fit * r.location.workplacePoints + langPts),
    r.location.max,
  );
  signals.push({
    id: 'location',
    label: 'Location',
    detail: [
      o.location ? `${o.location}${region ? ` (${region})` : ''}` : 'Location not stated',
      REMOTE_LABEL[o.remote_type],
      o.language === 'en' ? 'English' : o.language === 'fr' ? 'French' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    points: locPts,
  });
  if (o.remote_type === 'remote') summary.push('remote');

  // --- Visa (flat) ---
  const visa = c.visa.find(o.description ?? '');
  signals.push({
    id: 'visa',
    label: 'Visa friendly',
    detail: visa ? quote(visa) : 'Not mentioned',
    points: visa ? r.visa.points : 0,
  });
  if (visa) summary.push('visa friendly');

  // --- Watchlist, freshness, deadline ---
  const watched = c.watchlist.has(fold(o.org.trim()));
  signals.push({
    id: 'watchlist',
    label: 'Watchlist company',
    detail: watched ? 'On your watchlist' : 'Not on your watchlist',
    points: watched ? r.watchlist.points : 0,
  });
  const postedAt = new Date(o.posted_at ?? o.first_seen_at);
  const ageDays = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / DAY_MS));
  const fresh = ageDays <= r.fresh.days;
  signals.push({
    id: 'fresh',
    label: 'Fresh posting',
    detail: ageDays === 0 ? 'Posted today' : `Posted ${plural(ageDays, 'day')} ago`,
    points: fresh ? r.fresh.points : 0,
  });
  const daysLeft = o.deadline_at
    ? Math.floor((new Date(o.deadline_at).getTime() - now.getTime()) / DAY_MS)
    : null;
  const deadlineOk = daysLeft !== null && daysLeft > r.deadline.minDaysAway;
  signals.push({
    id: 'deadline',
    label: 'Deadline known',
    detail:
      daysLeft === null
        ? 'No deadline yet'
        : daysLeft < 0
          ? 'Deadline passed'
          : `Closes in ${plural(daysLeft, 'day')}`,
    points: deadlineOk ? r.deadline.points : 0,
  });

  // --- Penalties (total capped at penalties.max) ---
  const penalties: ScoreSignal[] = [];
  const senior = c.senior.find(title);
  const studentType = r.hardFilters.studentTypes.includes(o.opportunity_type);
  if (senior && !(studentType && c.allowedInStudentTitles.has(fold(senior)))) {
    penalties.push({
      id: 'senior',
      label: 'Senior wording',
      detail: `${quote(senior)} in title`,
      points: r.penalties.seniorTitle.points,
    });
    summary.unshift('senior wording');
  }
  const exp = c.experience.find(text);
  if (exp) {
    penalties.push({
      id: 'experience',
      label: 'Experience required',
      detail: quote(exp),
      points: r.penalties.experience.points,
    });
  }
  const langReq = languageRequirement(text, r.penalties.language.spoken);
  if (langReq) {
    penalties.push({
      id: 'language',
      label: 'Language',
      detail: `${quote(langReq)} required`,
      points: r.penalties.language.points,
    });
    notes.push(`Language: ${quote(langReq)}`);
    summary.unshift('language required');
  } else if (o.language === 'other') {
    penalties.push({
      id: 'language',
      label: 'Language',
      detail: 'Posting not in English or French',
      points: r.penalties.language.otherLanguagePostingPoints,
    });
  }
  if (profile.remotePreference === 'remote_only' && o.remote_type !== 'remote') {
    penalties.push({
      id: 'not_remote',
      label: 'Not remote',
      detail: `You want remote only; this is ${REMOTE_LABEL[o.remote_type]}`,
      points: r.penalties.notRemote.points,
    });
  }
  let budget = r.penalties.max;
  for (const p of penalties) {
    const applied = Math.max(p.points, -budget);
    budget += applied; // applied is negative
    signals.push({ ...p, points: applied });
  }

  // --- Eligibility (flags; may force needs_review or skip) ---
  const lock = c.lock.find(o.description ?? '');
  if (lock) {
    skipReasons.push(`Work authorization: ${quote(lock)}`);
    notes.push(`Work authorization: ${quote(lock)} excludes you`);
  } else {
    const amb = c.ambiguous.find(o.description ?? '');
    if (amb) {
      ambiguous = true;
      notes.push(`Work authorization: ${quote(amb)} may exclude you`);
      summary.push('work authorization unclear');
    }
  }
  const description = o.description ?? '';
  const foldedDescription = fold(description);
  const gpaMatch = GPA_RE.exec(foldedDescription);
  if (gpaMatch) {
    const gpa = originalSpan(
      description,
      foldedDescription,
      gpaMatch.index,
      gpaMatch[0].length,
    ).trim();
    ambiguous = true;
    notes.push(`GPA requirement: ${quote(gpa)} requested. Your ${profile.gradeRaw} is unverified`);
    summary.push('GPA requirement flagged');
  }
  const agreement = c.agreement.find(o.description ?? '');
  if (agreement) {
    notes.push(
      `School agreement: ${quote(agreement)} mentioned. Check with your school before applying`,
    );
  }

  // --- Hard filters (keep the row, verdict skip) ---
  const excluded = c.titleExcludes.find(title);
  if (excluded && !(studentType && c.allowedInStudentTitles.has(fold(excluded)))) {
    skipReasons.unshift(`Excluded title word ${quote(excluded)}`);
  }
  if (profile.searchMode === 'internships' && !studentType) {
    skipReasons.push('Not an internship (search mode: internships only)');
    summary.unshift('not an internship');
  }
  if (skipReasons.length) {
    signals.push({ id: 'filter', label: 'Hard filter', detail: skipReasons.join('; '), points: 0 });
  }

  const raw = signals.reduce((n, s) => n + s.points, 0);
  const score = Math.round(cap(raw, 100));
  const verdict: ScoreResult['verdict'] = skipReasons.length
    ? 'skip'
    : ambiguous
      ? 'needs_review'
      : score >= r.thresholds.apply
        ? 'apply'
        : score >= r.thresholds.maybe
          ? 'maybe'
          : 'skip';

  return {
    score,
    verdict,
    breakdown: {
      version: 1,
      summary: [...new Set(summary)].slice(0, 4).join(', ') || 'No strong signals',
      signals,
    },
    eligibilityNotes: notes.length ? notes.join('\n') : null,
  };
}
