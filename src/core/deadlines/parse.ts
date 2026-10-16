// Deadline and opening-date parser for free text, English and French (SPEC section 7).
//
// A date only counts when a cue introduces it ("apply by", "deadline:", "jusqu'au",
// "applications open from", ...): the nearest cue before the date decides its kind, and cues such
// as "posted", "founded" or "start date" make the date irrelevant. Bare years ("founded in 2015")
// are never dates. The original sentence is always returned with the parse.
//
// Year inference (dates written without a year), relative to a reference date (the posting date
// when known, otherwise now), on the user's local calendar:
//   - the date this year is on or after the reference day: that date (confidence medium);
//   - it fell 1-60 days before the reference: ambiguous (already passed, or next year?), so it is
//     kept as this year's date with confidence low and a note;
//   - it fell more than 60 days before: next year (confidence medium).
// Numeric dates are read day-first (FR/EU). When both parts could be the month (03/04) and the
// text is not French or another European language, the date is flagged low instead of guessed.
// A deadline means the end of that day (23:59:59.999) in the user's time zone; an opening date
// means its start (00:00). Month-only deadlines ("deadline: March 2027") are low confidence.
import { daysInMonth, endOfLocalDay, localDaysBetween, startOfLocalDay, zonedParts } from '../time';

export type DateKind = 'deadline' | 'opens' | 'rolling';
export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedDate {
  kind: DateKind;
  /** UTC ISO instant; null for `rolling`. */
  date: string | null;
  /** The sentence the date came from, verbatim (trimmed, at most 300 characters). */
  sentence: string;
  confidence: Confidence;
  /** The matched date text, e.g. "31 mars 2027". */
  match: string | null;
  /** Why the confidence is low, in plain words. */
  note: string | null;
}

export interface ParseContext {
  /** Dates without a year are placed relative to this (posting date, else now). */
  reference: Date;
  /** IANA zone from Settings; calendar days are the user's local days. */
  timeZone: string;
  /** Language of the whole text, when known; 'fr' and 'other' make day-first certain. */
  language?: 'en' | 'fr' | 'other' | 'unknown';
}

// ---------- vocabulary ----------

// prettier-ignore
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, janv: 1,
  february: 2, feb: 2, février: 2, fevrier: 2, févr: 2, fevr: 2, fév: 2, fev: 2,
  march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, avr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juin: 6,
  july: 7, jul: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, août: 8, aout: 8,
  september: 9, sept: 9, sep: 9, septembre: 9,
  october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11,
  december: 12, dec: 12, décembre: 12, decembre: 12, déc: 12,
};

/** Full month names that may stand alone ("open from January"); "may"/"mai" are too ambiguous. */
const STANDALONE_MONTHS = new Set(
  Object.keys(MONTHS).filter(
    (m) => m.length >= 4 && !['sept', 'janv', 'févr', 'fevr', 'juil'].includes(m),
  ),
);

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const AP = "['’]";

const M = String.raw`(${MONTH_ALT})\.?(?![\p{L}])`;
const D = String.raw`(?<![\p{N}.,/:])(\d{1,2})(?:st|nd|rd|th|er)?(?![\p{N}])`;
const Y = String.raw`(\d{4})(?![\p{N}])`;
const TO = String.raw`\s*(?:-|–|—|to|through|until|till|au|à|jusqu${AP}au)\s*`;

type CueKind = DateKind | 'window' | 'ignore';

/** Order matters only for overlaps: earlier lists win (rolling beats deadline beats opens ...). */
const CUES: [CueKind, RegExp][] = [
  [
    'rolling',
    new RegExp(
      [
        // Never a bare "rolling" ("rolling up sleeves" is not a deadline).
        String.raw`rolling\s+(?:basis|admissions?|applications?|deadlines?|reviews?|intake)`,
        String.raw`on\s+a\s+rolling`,
        String.raw`(?:until|till)\s+(?:the\s+)?(?:position|role|vacancy|post|job)?\s*(?:is\s+|has\s+been\s+)?filled`,
        String.raw`au\s+fil\s+de\s+l${AP}eau`,
        String.raw`au\s+fur\s+et\s+à\s+mesure`,
        String.raw`jusqu${AP}à\s+ce\s+que\s+le\s+poste\s+soit\s+pourvu`,
      ].join('|'),
      'giu',
    ),
  ],
  [
    'ignore',
    new RegExp(
      [
        String.raw`posted(?:\s+on)?`,
        String.raw`published(?:\s+on)?`,
        String.raw`publiée?(?:\s+le)?`,
        String.raw`(?:last\s+)?updated(?:\s+on)?`,
        String.raw`mis\s+à\s+jour(?:\s+le)?`,
        String.raw`founded`,
        String.raw`established`,
        String.raw`since`,
        String.raw`depuis`,
        String.raw`start(?:s|ing)?(?:\s+date)?`,
        String.raw`begin(?:s|ning)?`,
        String.raw`date\s+de\s+début`,
        String.raw`début(?:e|era)?`,
        String.raw`commence(?:ra|ment)?`,
        String.raw`interviews?`,
        String.raw`entretiens?`,
        String.raw`results?`,
        String.raw`résultats?`,
      ].join('|'),
      'giu',
    ),
  ],
  [
    'deadline',
    new RegExp(
      [
        String.raw`(?:application\s+)?deadlines?`,
        String.raw`apply\s+(?:no\s+later\s+than|by|before|until)`,
        String.raw`(?:submit|send)(?:\s+[\p{L}'’]+){0,4}?\s+(?:no\s+later\s+than|by|before)`,
        String.raw`applications?\s+(?:are\s+|will\s+be\s+)?(?:accepted|received|considered|open)\s+(?:until|through)`,
        String.raw`applications?\s+(?:will\s+)?(?:close|closes|closing|are\s+due|due)(?:\s+(?:on|at))?`,
        String.raw`applications?\s+must\s+be\s+(?:received|submitted)\s+by`,
        String.raw`closing\s+date`,
        String.raw`closes?\s+on`,
        String.raw`(?:open|accepted)\s+until`,
        String.raw`last\s+day\s+to\s+apply`,
        String.raw`no\s+later\s+than`,
        String.raw`date\s+limite(?:\s+de\s+(?:dépôt|candidature))?`,
        String.raw`avant\s+le`,
        String.raw`jusqu${AP}au`,
        String.raw`au\s+plus\s+tard(?:\s+le)?`,
        String.raw`clôture\s+des\s+candidatures`,
        String.raw`date\s+de\s+clôture`,
        String.raw`candidatures?\s+(?:closes|clôturées)(?:\s+le)?`,
        String.raw`fin\s+des\s+candidatures`,
      ].join('|'),
      'giu',
    ),
  ],
  [
    'opens',
    new RegExp(
      [
        String.raw`applications?\s+(?:will\s+)?(?:open|opens|opening)(?!\s+until)(?:\s+(?:on|from|in))?`,
        String.raw`(?:opens|will\s+open)(?:\s+(?:on|in|from))?`,
        String.raw`open\s+from`,
        String.raw`ouverture\s+des\s+candidatures`,
        String.raw`candidatures?\s+(?:ouvertes|s${AP}ouvrent|ouvriront)`,
        String.raw`candidatures?[^.;]{0,30}?(?:à\s+partir\s+d[ue]|dès\s+le)`,
      ].join('|'),
      'giu',
    ),
  ],
  // A weak cue: only a date range right after it counts (an application window, e.g.
  // "Contributor applications: Mar 16-31").
  ['window', /applications?|application\s+(?:period|window)|candidatures?/giu],
];

// ---------- date expressions ----------

interface DayMonth {
  year: number | null;
  month: number;
  /** null for month-only expressions. */
  day: number | null;
}

interface DateHit {
  start: number;
  end: number;
  text: string;
  from: DayMonth;
  /** Ranges only. */
  to: DayMonth | null;
  /** Numeric date where day and month could be swapped. */
  ambiguousOrder: boolean;
  /** Numeric month-first date (US style). */
  monthFirst: boolean;
  invalid?: boolean;
}

const month = (s: string | undefined) => (s ? (MONTHS[s.toLowerCase()] ?? null) : null);
const num = (s: string | undefined) => (s ? Number(s) : null);
const year = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s);
  return s.length === 2 ? 2000 + n : n;
};

type Builder = (m: RegExpMatchArray) => Omit<DateHit, 'start' | 'end' | 'text'> | null;

const plain = (from: DayMonth, to: DayMonth | null = null) => ({
  from,
  to,
  ambiguousOrder: false,
  monthFirst: false,
});

const PATTERNS: [RegExp, Builder][] = [
  // 16-31 March 2027 · 16 March - 2 April 2027 · du 16 au 31 mars
  [
    new RegExp(
      String.raw`${D}(?:\s+(?:of\s+|de\s+)?${M})?(?:,?\s+${Y})?${TO}${D}\s+(?:of\s+|de\s+)?${M}(?:,?\s+${Y})?`,
      'giu',
    ),
    (m) => {
      const m2 = month(m[5])!;
      const y2 = year(m[6]);
      return plain(
        { year: year(m[3]) ?? null, month: month(m[2]) ?? m2, day: num(m[1]) },
        { year: y2, month: m2, day: num(m[4]) },
      );
    },
  ],
  // March 16-31, 2027 · Mar 16 - Apr 2
  [
    new RegExp(String.raw`${M}\s+${D}(?:,?\s+${Y})?${TO}(?:${M}\s+)?${D}(?:,?\s+${Y})?`, 'giu'),
    (m) => {
      const m1 = month(m[1])!;
      return plain(
        { year: year(m[3]), month: m1, day: num(m[2]) },
        { year: year(m[6]), month: month(m[4]) ?? m1, day: num(m[5]) },
      );
    },
  ],
  // 2027-03-31
  [
    /(?<![\p{N}])(\d{4})-(\d{2})-(\d{2})(?![\p{N}])/gu,
    (m) => plain({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }),
  ],
  // 31/03/2027 · 31.03.2027 · 31-03-27 · 15/11
  [
    /(?<![\p{N}.,/])(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\p{N}]|[/.,]\p{N})/gu,
    (m) => {
      const a = Number(m[1]);
      const b = Number(m[3]);
      const y = year(m[4]);
      if (!y && m[2] !== '/') return null; // "3.5" or "1-2" without a year is not a date
      if (a > 12 && b > 12) return null;
      if (a > 12 || a === b) return plain({ year: y, month: b, day: a });
      if (b > 12) return { ...plain({ year: y, month: a, day: b }), monthFirst: true };
      return { ...plain({ year: y, month: b, day: a }), ambiguousOrder: true };
    },
  ],
  // 31 March 2027 · 1er avril · 31st of March
  [
    new RegExp(String.raw`${D}\s+(?:of\s+|de\s+)?${M}(?:,?\s+${Y})?`, 'giu'),
    (m) => plain({ year: year(m[3]), month: month(m[2])!, day: num(m[1]) }),
  ],
  // March 31, 2027 · Mar. 31
  [
    new RegExp(String.raw`${M}\s+${D}(?:,?\s+${Y})?`, 'giu'),
    (m) => plain({ year: year(m[3]), month: month(m[1])!, day: num(m[2]) }),
  ],
  // March 2027
  [
    new RegExp(String.raw`${M}\s+${Y}`, 'giu'),
    (m) => plain({ year: year(m[2]), month: month(m[1])!, day: null }),
  ],
  // January (full names only)
  [
    new RegExp(String.raw`(?<![\p{L}])(${MONTH_ALT})(?![\p{L}])`, 'giu'),
    (m) =>
      STANDALONE_MONTHS.has(m[1]!.toLowerCase())
        ? plain({ year: null, month: month(m[1])!, day: null })
        : null,
  ],
];

function validDay(d: DayMonth): boolean {
  if (d.month < 1 || d.month > 12) return false;
  if (d.year !== null && (d.year < 2000 || d.year > 2100)) return false;
  if (d.day === null) return true;
  return d.day >= 1 && d.day <= daysInMonth(d.year ?? 2028, d.month); // 2028: Feb 29 allowed
}

function findDates(sentence: string): DateHit[] {
  const hits: DateHit[] = [];
  for (const [re, build] of PATTERNS) {
    for (const m of sentence.matchAll(re)) {
      const built = build(m);
      if (!built) continue;
      // An impossible date (29 February 2027) still claims its text, so no shorter pattern
      // inside it ("February 2027") is read instead; it is dropped after overlap resolution.
      const invalid = !validDay(built.from) || (built.to !== null && !validDay(built.to));
      hits.push({
        ...built,
        invalid,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0].trim(),
      });
    }
  }
  // Longest first at each position, then keep non-overlapping hits from left to right.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DateHit[] = [];
  for (const h of hits) {
    if (kept.every((k) => h.start >= k.end || h.end <= k.start)) kept.push(h);
  }
  return kept.filter((h) => !h.invalid);
}

interface CueHit {
  kind: CueKind;
  start: number;
  end: number;
}

function findCues(sentence: string): CueHit[] {
  const hits: CueHit[] = [];
  for (const [kind, re] of CUES) {
    for (const m of sentence.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      // Word boundaries (accent-aware), checked here so every pattern stays readable.
      if (/[\p{L}\p{N}]/u.test(sentence[start - 1] ?? '')) continue;
      if (/[\p{L}\p{N}]/u.test(sentence[end] ?? '')) continue;
      if (hits.some((h) => start < h.end && end > h.start)) continue; // earlier kinds win
      hits.push({ kind, start, end });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ---------- sentences ----------

const ABBREV_END = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:${MONTH_ALT}|e\.g|i\.e|etc|approx|no|st)\.$`,
  'iu',
);

export function splitSentences(text: string): string[] {
  const pieces = text.split(/\n+|(?<=[.!?;])\s+(?=[\p{Lu}\p{N}«"“(])/u);
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && ABBREV_END.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

const FRENCH_HINT =
  /\b(?:candidatures?|jusqu|avant le|date limite|au plus tard|postuler|stage)\b|[àâçéèêîôûœ]/iu;

// ---------- resolution ----------

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const lower = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

interface Resolved {
  year: number;
  month: number;
  day: number | null;
  confidence: Confidence;
  note: string | null;
}

/** Puts a year on a day/month written without one (see the rule at the top of this file). */
function resolveYear(dm: DayMonth, ctx: ParseContext): Resolved {
  if (dm.year !== null) return { ...dm, year: dm.year, confidence: 'high', note: null };
  const ref = zonedParts(ctx.reference, ctx.timeZone);
  const refDay = Date.UTC(ref.year, ref.month - 1, ref.day);
  // Month-only dates compare by their last day, so "deadline: March" in mid-March is this March.
  const dayOf = (y: number) => dm.day ?? daysInMonth(y, dm.month);
  const thisYear = Date.UTC(
    ref.year,
    dm.month - 1,
    Math.min(dayOf(ref.year), daysInMonth(ref.year, dm.month)),
  );
  const daysBefore = Math.round((refDay - thisYear) / 86_400_000);
  if (daysBefore <= 0) return { ...dm, year: ref.year, confidence: 'medium', note: null };
  if (daysBefore <= 60) {
    return {
      ...dm,
      year: ref.year,
      confidence: 'low',
      note: 'no year given and the date has just passed (stale posting, or next year?)',
    };
  }
  return { ...dm, year: ref.year + 1, confidence: 'medium', note: null };
}

function toInstant(r: Resolved, kind: 'deadline' | 'opens', tz: string): string | null {
  const day = r.day ?? (kind === 'deadline' ? daysInMonth(r.year, r.month) : 1);
  if (day > daysInMonth(r.year, r.month)) return null; // Feb 29 in a non-leap year
  const at =
    kind === 'deadline'
      ? endOfLocalDay(r.year, r.month, day, tz)
      : startOfLocalDay(r.year, r.month, day, tz);
  return at.toISOString();
}

function emit(
  out: ParsedDate[],
  kind: 'deadline' | 'opens',
  r: Resolved,
  base: { sentence: string; match: string; confidence: Confidence; note: string | null },
  tz: string,
): void {
  let confidence = lower(base.confidence, r.confidence);
  let note = base.note ?? r.note;
  if (kind === 'deadline' && r.day === null) {
    confidence = 'low';
    note ??= 'only a month is given';
  }
  const date = toInstant(r, kind, tz);
  if (date === null) return;
  out.push({ kind, date, sentence: base.sentence, confidence, match: base.match, note });
}

/** Every deadline, opening date and rolling mention in `text`, in reading order. */
export function parseDates(text: string, ctx: ParseContext): ParsedDate[] {
  const out: ParsedDate[] = [];
  for (const raw of splitSentences(text)) {
    const sentence = raw.slice(0, 300);
    const cues = findCues(raw);
    if (cues.length === 0) continue;
    for (const c of cues) {
      if (c.kind === 'rolling') {
        out.push({
          kind: 'rolling',
          date: null,
          sentence,
          confidence: 'high',
          match: null,
          note: null,
        });
      }
    }
    const dayFirstSure = ctx.language === 'fr' || ctx.language === 'other' || FRENCH_HINT.test(raw);

    for (const hit of findDates(raw)) {
      const cue = [...cues].reverse().find((c) => c.end <= hit.start);
      if (!cue || hit.start - cue.end > 80) continue;
      // Another date between the cue and this one belongs to the cue; this one only counts if
      // it is joined to it ("March 31 or April 15" is rare; ranges are one hit).
      if (cue.kind === 'ignore' || cue.kind === 'rolling') continue;
      if (cue.kind === 'window' && !hit.to) continue;

      let confidence: Confidence = 'high';
      let note: string | null = null;
      if (hit.ambiguousOrder && !dayFirstSure) {
        confidence = 'low';
        note = 'numeric date could be day/month or month/day';
      } else if (hit.monthFirst) {
        confidence = 'medium';
      }
      const base = { sentence, match: hit.text, confidence, note };

      if (hit.to) {
        // A range is a window: it opens on the first day and closes on the last.
        const from = resolveYear(hit.from, ctx);
        let to: Resolved;
        if (hit.to.year !== null)
          to = { ...hit.to, year: hit.to.year, confidence: 'high', note: null };
        else {
          const y = hit.from.year ?? from.year;
          const before =
            hit.to.month < from.month ||
            (hit.to.month === from.month && (hit.to.day ?? 31) < (from.day ?? 1));
          to = {
            ...hit.to,
            year: before ? y + 1 : y,
            confidence: from.confidence,
            note: from.note,
          };
        }
        if (hit.from.year === null && hit.to.year !== null) {
          const before = hit.from.month > hit.to.month;
          from.year = before ? hit.to.year - 1 : hit.to.year;
          from.confidence = 'high';
          from.note = null;
        }
        emit(out, 'opens', from, base, ctx.timeZone);
        emit(out, 'deadline', to, base, ctx.timeZone);
        continue;
      }
      emit(
        out,
        cue.kind === 'opens' ? 'opens' : 'deadline',
        resolveYear(hit.from, ctx),
        base,
        ctx.timeZone,
      );
    }
  }
  return out;
}

/** Days from `now` to a parsed date on the user's calendar (negative when passed). */
export function daysUntil(dateIso: string, now: Date, timeZone: string): number {
  return localDaysBetween(now, new Date(dateIso), timeZone);
}
