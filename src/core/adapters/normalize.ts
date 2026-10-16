// Normalizers shared by every adapter: HTML to text, remote type, opportunity type, language
// and the deadline sentence. Keyword lists are explicit and matched on word boundaries.
import type { OpportunityTypeGuess, RemoteType } from './types';

// ---------- HTML ----------

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ecirc: 'ê',
  euro: '€',
  copy: '©',
  trade: '™',
};

/** Decodes named and numeric HTML entities once. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/**
 * Plain text from HTML: block elements become line breaks, list items get a bullet, tags are
 * dropped, entities decoded, whitespace collapsed. Never used to render; display is always text.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section|article|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- keyword matching ----------

/** Case-insensitive, accent-tolerant match of whole words or phrases. */
export function wordRegExp(words: readonly string[]): RegExp {
  const alts = words.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+'),
  );
  // \p{L}/\p{N} boundaries so "intern" never matches inside "internal" or "international".
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Keyword lists per opportunity type (English, French, German). Order of checks: PFE first. */
export const TYPE_KEYWORDS = {
  pfe: [
    'pfe',
    'projet de fin d’études',
    "projet de fin d'études",
    'projet de fin d’etudes',
    "projet de fin d'etudes",
    'stage de fin d’études',
    "stage de fin d'études",
    'end of studies internship',
    'end-of-studies internship',
    'final year internship',
    'master thesis',
    'master’s thesis',
    "master's thesis",
    'masterarbeit',
  ],
  internship: [
    'intern',
    'interns',
    'internship',
    'internships',
    'co-op',
    'coop',
    'summer student',
    'stage',
    'stages',
    'stagiaire',
    'stagiaires',
    'alternance',
    'alternant',
    'alternante',
    'apprenti',
    'apprentie',
    'apprentissage',
    'praktikum',
    'praktikant',
    'praktikantin',
    'werkstudent',
    'werkstudentin',
    'working student',
  ],
  program: [
    'fellowship',
    'fellow program',
    'residency',
    'research program',
    'research programme',
    'summer school',
    'summer of code',
    'programme de recherche',
  ],
  junior: [
    'junior',
    'graduate',
    'new grad',
    'entry level',
    'entry-level',
    'early career',
    'trainee',
    'traineeship',
    'débutant',
    'debutant',
    'jeune diplômé',
    'jeune diplome',
    'berufseinsteiger',
  ],
  fulltime: [
    'full time',
    'full-time',
    'fulltime',
    'permanent',
    'cdi',
    'unbefristet',
    'festanstellung',
    'vollzeit',
  ],
} as const;

const RE = {
  pfe: wordRegExp(TYPE_KEYWORDS.pfe),
  internship: wordRegExp(TYPE_KEYWORDS.internship),
  program: wordRegExp(TYPE_KEYWORDS.program),
  junior: wordRegExp(TYPE_KEYWORDS.junior),
  fulltime: wordRegExp(TYPE_KEYWORDS.fulltime),
};

export function matchesKeywords(text: string, kind: keyof typeof TYPE_KEYWORDS): boolean {
  return RE[kind].test(text);
}

// English "stage" as in company maturity is not an internship ("early-stage startup").
const COMPANY_STAGE_RE = /\b(?:early|seed|late|growth|pre-seed|series\s+[a-e])[\s-]+stages?\b/giu;

/** Type guess from free text (a title, or job-type labels). */
function typeFromText(text: string): OpportunityTypeGuess | null {
  if (RE.pfe.test(text)) return 'pfe';
  if (RE.internship.test(text.replace(COMPANY_STAGE_RE, ' '))) return 'internship';
  if (RE.program.test(text)) return 'program';
  if (RE.junior.test(text)) return 'junior';
  return null;
}

export interface TypeSignals {
  /** Structured employment type from the source (e.g. Ashby "Intern", "FullTime"). */
  employmentType?: string | null;
  title: string;
  /** Free-form labels such as Arbeitnow job_types. */
  labels?: readonly string[];
}

/**
 * Opportunity type: the source's employment type first (an "Intern" type wins, PFE titles stay
 * PFE), then title keywords, then labels, then a full-time employment type, else unknown.
 */
export function guessOpportunityType(s: TypeSignals): OpportunityTypeGuess {
  const employment = (s.employmentType ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const fromTitle = typeFromText(s.title);
  if (employment === 'intern' || employment === 'internship') {
    return fromTitle === 'pfe' ? 'pfe' : 'internship';
  }
  if (fromTitle) return fromTitle;
  const labels = (s.labels ?? []).join(' | ');
  const fromLabels = typeFromText(labels);
  if (fromLabels) return fromLabels;
  if (employment === 'fulltime' || employment === 'permanent' || RE.fulltime.test(labels)) {
    return 'fulltime';
  }
  return 'unknown';
}

// ---------- remote type ----------

const REMOTE_RE = wordRegExp([
  'remote',
  'fully remote',
  'télétravail',
  'teletravail',
  'remote-first',
]);
const HYBRID_RE = wordRegExp(['hybrid', 'hybride']);
const ONSITE_RE = wordRegExp([
  'on-site',
  'onsite',
  'on site',
  'in office',
  'sur site',
  'présentiel',
]);

export interface RemoteSignals {
  /** Structured value, e.g. Ashby "Remote" | "Hybrid" | "OnSite", Lever "remote" | "hybrid" | "onsite". */
  workplaceType?: string | null;
  isRemote?: boolean | null;
  /** Short text such as title and location (not the whole description: too noisy). */
  text?: string;
}

export function normalizeRemoteType(s: RemoteSignals): RemoteType {
  const w = (s.workplaceType ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (w === 'remote') return 'remote';
  if (w === 'hybrid') return 'hybrid';
  if (w === 'onsite' || w === 'office' || w === 'inoffice') return 'onsite';
  const text = s.text ?? '';
  if (HYBRID_RE.test(text)) return 'hybrid';
  if (s.isRemote === true || REMOTE_RE.test(text)) return 'remote';
  if (ONSITE_RE.test(text)) return 'onsite';
  if (s.isRemote === false) return 'onsite';
  return 'unknown';
}

// ---------- language ----------

const STOPWORDS = {
  en: [
    'the',
    'and',
    'you',
    'with',
    'for',
    'our',
    'will',
    'are',
    'your',
    'team',
    'experience',
    'we',
  ],
  fr: ['le', 'la', 'les', 'et', 'des', 'vous', 'pour', 'avec', 'une', 'nous', 'dans', 'est', 'du'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'sie', 'ist', 'ein', 'eine', 'bei', 'zu'],
  es: ['el', 'los', 'las', 'y', 'con', 'para', 'nuestro', 'una', 'en', 'es', 'del', 'por'],
} as const;

/** Simple stopword vote. Needs a few hits to decide; short or mixed text stays unknown. */
export function guessLanguage(text: string): 'en' | 'fr' | 'other' | 'unknown' {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return 'unknown';
  const counts = Object.fromEntries(
    Object.entries(STOPWORDS).map(([lang, list]) => {
      const set = new Set<string>(list);
      return [lang, words.filter((w) => set.has(w)).length];
    }),
  ) as Record<keyof typeof STOPWORDS, number>;
  const ranked = (Object.entries(counts) as [keyof typeof STOPWORDS, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [top, second] = ranked;
  if (!top || top[1] < 3 || (second && top[1] < second[1] * 1.5)) return 'unknown';
  return top[0] === 'en' || top[0] === 'fr' ? top[0] : 'other';
}

// ---------- deadline sentence ----------

const DEADLINE_RE = wordRegExp([
  'deadline',
  'apply by',
  'apply before',
  'applications close',
  'application closes',
  'applications are open until',
  'closing date',
  'until filled',
  'rolling basis',
  'date limite',
  'avant le',
  'jusqu’au',
  "jusqu'au",
  'candidatures closes',
  'bewerbungsfrist',
  'bewerbungsschluss',
]);

/** The first sentence that talks about a deadline, kept verbatim for the deadline parser (M5). */
export function findDeadlineSentence(text: string | null): string | null {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hit = sentences.find((s) => DEADLINE_RE.test(s));
  return hit ? hit.trim().slice(0, 300) : null;
}

// ---------- dates ----------

/** Any parseable date or epoch to a UTC ISO string; null when missing or invalid. */
export function toUtcIso(
  value: string | number | null | undefined,
  unit: 's' | 'ms' = 'ms',
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d =
    typeof value === 'number' ? new Date(unit === 's' ? value * 1000 : value) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
