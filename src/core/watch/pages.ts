// Page-change detection (SPEC section 7) for program pages and sources of kind 'page'.
// Pages go through the shared fetch layer (robots.txt, rate limits). The text is normalized so
// timestamps, scripts, navigation and cookie banners never count as a change, then hashed. The
// first fetch only records a baseline; a later change stores a snapshot and an alert with a
// short line diff.
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { htmlToText } from '../adapters/normalize';
import { sourceRowSchema, utcTimestampSchema, type SourceRow } from '../db/schemas';
import type { HttpClient } from '../http/client';
import { PAGE_KIND } from '../sources/seeds';

// ---------- normalization ----------

const DROP_ELEMENTS =
  /<(script|style|noscript|svg|template|iframe|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Innermost element whose id or class names a cookie/consent banner (repeated for nesting).
const BANNER_ELEMENT =
  /<(div|section|aside|dialog|p)\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*(?:cookie|consent|gdpr|onetrust)[^"']*["'][^>]*>(?:(?!<\1\b)[\s\S])*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

/** Whole lines that are noise: banners, "last updated" stamps, copyright, view counters. */
const NOISE_LINE = new RegExp(
  [
    String.raw`\b(?:we|this site|this website)\s+uses?\s+cookies\b`,
    String.raw`\baccept\s+(?:all\s+)?cookies\b`,
    String.raw`\bcookie\s+(?:settings|preferences|policy)\b`,
    String.raw`\bnous\s+utilisons\s+des\s+cookies\b`,
    String.raw`^\s*(?:last\s+)?(?:updated|modified|generated|published)\b`,
    String.raw`^\s*(?:dernière\s+)?mise\s+à\s+jour\b`,
    String.raw`^\s*mis\s+à\s+jour\b`,
    String.raw`^\s*(?:©|\(c\)|copyright)`,
    String.raw`\b\d[\d,.\s]*\s+(?:views|vues)\b`,
  ].join('|'),
  'iu',
);

/** Timestamps inside lines: clock times, ISO date-times, "3 hours ago". Dates stay (deadlines!). */
const TIMESTAMPS = [
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?(?:\s?(?:UTC|GMT|CET|CEST|EST|EDT|PST|PDT|BST))?\b/gi,
  /\b(?:\d+|an?|one)\s+(?:seconds?|minutes?|mins?|hours?|days?|weeks?)\s+ago\b/gi,
  /\bil\s+y\s+a\s+\d+\s+(?:secondes?|minutes?|heures?|jours?)\b/gi,
];

export function normalizePageText(html: string): string {
  let h = html.replace(COMMENT, '').replace(DROP_ELEMENTS, '');
  for (let i = 0; i < 5; i++) {
    const next = h.replace(BANNER_ELEMENT, '');
    if (next === h) break;
    h = next;
  }
  return htmlToText(h)
    .split('\n')
    .filter((line) => !NOISE_LINE.test(line))
    .map((line) => TIMESTAMPS.reduce((l, re) => l.replace(re, ''), line))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '•')
    .join('\n');
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------- diff ----------

const MAX_LINE = 160;
const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

/**
 * A short line diff ("- old" / "+ new"), at most `maxLines` lines. Common leading and trailing
 * lines are skipped, then the middle is compared with an LCS (bounded size).
 */
export function diffText(before: string, after: string, maxLines = 12): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const lines: string[] = [];
  if (midA.length * midB.length <= 250_000) {
    // LCS table, then walk it.
    const n = midA.length;
    const m = midB.length;
    const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i]![j] =
          midA[i] === midB[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        i++;
        j++;
      } else if (i < n && (j === m || t[i + 1]![j]! >= t[i]![j + 1]!)) {
        lines.push(`- ${clip(midA[i++]!)}`); // removals before additions
      } else lines.push(`+ ${clip(midB[j++]!)}`);
    }
  } else {
    lines.push(...midA.map((l) => `- ${clip(l)}`), ...midB.map((l) => `+ ${clip(l)}`));
  }
  if (lines.length <= maxLines) return lines.join('\n');
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more changed lines`].join(
    '\n',
  );
}

// ---------- watching ----------

/** Stored text is capped so one huge page cannot bloat the database. */
const MAX_STORED = 200_000;

const snapshotSchema = z.object({
  id: z.int(),
  content_hash: z.string(),
  text_excerpt: z.string().nullable(),
  fetched_at: utcTimestampSchema,
});

export type PageCheck =
  | { source: string; outcome: 'baseline' | 'unchanged' | 'skipped' }
  | { source: string; outcome: 'changed'; alertId: number }
  | { source: string; outcome: 'failed'; error: string };

export interface WatchOptions {
  http: HttpClient;
  now: Date;
  /** Pages checked more recently than this are skipped (default 20 h: about once a day). */
  minIntervalHours?: number;
  /** Check these sources regardless of the interval. */
  force?: boolean;
}

export function watchedPages(db: Database.Database): SourceRow[] {
  return db
    .prepare(
      'SELECT * FROM sources WHERE kind = ? AND enabled = 1 AND paused = 0 AND url IS NOT NULL ORDER BY id',
    )
    .all(PAGE_KIND)
    .map((r) => sourceRowSchema.parse(r));
}

/** Checks one page. Network happens before any write; never throws for a page failure. */
export async function checkPage(
  db: Database.Database,
  source: SourceRow,
  opts: WatchOptions,
): Promise<PageCheck> {
  const iso = opts.now.toISOString();
  let text: string;
  try {
    // Always the same language, or a page that localizes by IP looks "changed" between fetches.
    const res = await opts.http.get(source.url!, {
      accept: 'text/html',
      language: 'en-US,en;q=0.9',
    });
    text = normalizePageText(res.body).slice(0, MAX_STORED);
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300);
    db.prepare('UPDATE sources SET last_error = ? WHERE id = ?').run(error, source.id);
    console.error(`[watch] ${source.name} failed: ${error}`);
    return { source: source.name, outcome: 'failed', error };
  }
  const hash = hashText(text);

  return db.transaction((): PageCheck => {
    db.prepare(
      'UPDATE sources SET last_ok_at = ?, last_error = NULL, consecutive_empty = ? WHERE id = ?',
    ).run(iso, text === '' ? source.consecutive_empty + 1 : 0, source.id);
    const hours = opts.minIntervalHours ?? 20;
    db.prepare('UPDATE programs SET next_check_at = ? WHERE source_id = ?').run(
      new Date(opts.now.getTime() + hours * 3_600_000).toISOString(),
      source.id,
    );

    const raw = db
      .prepare(
        'SELECT id, content_hash, text_excerpt, fetched_at FROM page_snapshots WHERE source_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(source.id);
    const prev = raw === undefined ? undefined : snapshotSchema.parse(raw);
    if (prev?.content_hash === hash) return { source: source.name, outcome: 'unchanged' };

    db.prepare(
      'INSERT INTO page_snapshots (source_id, content_hash, text_excerpt, fetched_at) VALUES (?, ?, ?, ?)',
    ).run(source.id, hash, text, iso);
    if (!prev) return { source: source.name, outcome: 'baseline' };

    const program = db
      .prepare('SELECT id, name FROM programs WHERE source_id = ?')
      .get(source.id) as { id: number; name: string } | undefined;
    const { id } = db
      .prepare(
        `INSERT INTO alerts (kind, source_id, program_id, title, body, created_at)
         VALUES ('page_changed', ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        source.id,
        program?.id ?? null,
        `${program?.name ?? source.name}: page changed, review`,
        diffText(prev.text_excerpt ?? '', text),
        iso,
      ) as { id: number };
    return { source: source.name, outcome: 'changed', alertId: id };
  })();
}

/** Checks every watched page that is due. One at a time; the fetch layer paces each host. */
export async function watchPages(db: Database.Database, opts: WatchOptions): Promise<PageCheck[]> {
  const cutoff = opts.now.getTime() - (opts.minIntervalHours ?? 20) * 3_600_000;
  const out: PageCheck[] = [];
  for (const source of watchedPages(db)) {
    const recent = source.last_ok_at !== null && new Date(source.last_ok_at).getTime() > cutoff;
    if (recent && !opts.force) {
      out.push({ source: source.name, outcome: 'skipped' });
      continue;
    }
    out.push(await checkPage(db, source, opts));
  }
  return out;
}
