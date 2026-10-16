// Dedupe (SPEC section 4): key = lower(org) | normalized(title) | normalized(location), plus a
// canonical URL so the same posting seen through two sources merges into one opportunity.

/** Gender and contract markers that differ between boards for the same posting. */
const NOISE = [
  /\((?:[mwfdhxi]\s*\/\s*){1,3}[mwfdhxi]\)/gi, // (m/w/d), (f/h), (m/f/x), (w/m/d)
  /\b(?:[mwfdh]\s*\/\s*){1,3}[mwfdh]\b/gi, // m/w/d, h/f without parentheses
  /\(all genders?\)/gi,
  /\(gn\)/gi,
];

/** Lowercase, accent-free, punctuation-free, single-spaced. */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return '';
  let t = s;
  for (const re of NOISE) t = t.replace(re, ' ');
  return t
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function dedupeKey(item: { org: string; title: string; location: string | null }): string {
  return [
    item.org.trim().toLowerCase(),
    normalizeText(item.title),
    normalizeText(item.location),
  ].join('|');
}

/** Tracking parameters that never identify a posting. */
const TRACKING =
  /^(utm_[a-z]+|ref|referrer|source|src|gclid|fbclid|mc_[a-z]+|_hs[a-z]+|__hs[a-z]+|lever-origin|lever-source|gh_src)$/i;

/**
 * Canonical form of a posting URL: https, lowercase host without "www.", no fragment, no tracking
 * parameters, sorted query, no trailing slash. Identifying parameters (e.g. gh_jid) are kept.
 */
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  const kept = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}
