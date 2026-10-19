// Deadlines of scanned postings (M5). A date stated in the posting is `confirmed`; "rolling" and
// "until filled" are `rolling`; a low-confidence parse is `unknown` with its sentence kept and a
// note. A posting never gets `expected` (that is only for programs, from last cycle).
import type Database from 'better-sqlite3-multiple-ciphers';
import { drain, drainAsync, inChunks } from '../chunks';
import { z } from 'zod';
import { languageSchema, utcTimestampSchema } from '../db/schemas';
import { parseDates, type ParsedDate } from './parse';

export interface PostingDeadline {
  status: 'confirmed' | 'rolling' | 'unknown';
  deadline_at: string | null;
  /** The sentence the decision came from; null when the posting says nothing about a deadline. */
  sentence: string | null;
  /** Set when a date was found but not trusted. */
  note: string | null;
}

export interface PostingText {
  description: string | null;
  /** The adapter's deadline sentence (or a feed's own deadline field). */
  deadline_text: string | null;
  posted_at: string | null;
  first_seen_at: string;
  language: z.output<typeof languageSchema>;
}

/** Decides one posting's deadline. The reference for year inference is the posting date. */
export function postingDeadline(p: PostingText, timeZone: string): PostingDeadline {
  const text = [p.deadline_text, p.description].filter(Boolean).join('\n');
  const found = parseDates(text, {
    reference: new Date(p.posted_at ?? p.first_seen_at),
    timeZone,
    language: p.language,
  });
  const deadlines = found.filter((d): d is ParsedDate & { date: string } => d.kind === 'deadline');
  const trusted = deadlines.find((d) => d.confidence !== 'low');
  if (trusted) {
    return {
      status: 'confirmed',
      deadline_at: trusted.date,
      sentence: trusted.sentence,
      note: null,
    };
  }
  const rolling = found.find((d) => d.kind === 'rolling');
  if (rolling)
    return { status: 'rolling', deadline_at: null, sentence: rolling.sentence, note: null };
  const doubtful = deadlines[0];
  if (doubtful) {
    return {
      status: 'unknown',
      deadline_at: null,
      sentence: doubtful.sentence,
      note: doubtful.note ?? 'unclear date',
    };
  }
  return { status: 'unknown', deadline_at: null, sentence: p.deadline_text, note: null };
}

const rowSchema = z.object({
  id: z.int(),
  description: z.string().nullable(),
  deadline_text: z.string().nullable(),
  posted_at: utcTimestampSchema.nullable(),
  first_seen_at: utcTimestampSchema,
  language: languageSchema,
});

export interface DeadlineExtraction {
  checked: number;
  confirmed: number;
  rolling: number;
  doubtful: number;
}

/**
 * Re-reads the deadline of every stored posting (sample rows and manually closed ones excepted).
 * Deterministic: the same text and time zone always give the same result, so it is safe to run
 * after every scan and when the time zone changes.
 */
function extractChunks(db: Database.Database, timeZone: string, out: DeadlineExtraction) {
  const load = db.prepare(
    `SELECT o.id, o.description, o.deadline_text, o.posted_at, o.first_seen_at, o.language
       FROM opportunities o JOIN sources s ON s.id = o.source_id
      WHERE s.kind <> 'sample' AND o.deadline_status <> 'closed' AND o.id > ?
      ORDER BY o.id LIMIT ?`,
  );
  const update = db.prepare(
    `UPDATE opportunities SET deadline_at = ?, deadline_status = ?, deadline_text = ?,
       deadline_note = ? WHERE id = ?`,
  );
  return inChunks(
    db,
    (after, limit) => load.all(after, limit).map((r) => rowSchema.parse(r)),
    (rows) => {
      for (const row of rows) {
        const d = postingDeadline(row, timeZone);
        update.run(d.deadline_at, d.status, d.sentence, d.note, row.id);
        out.checked += 1;
        if (d.status === 'confirmed') out.confirmed += 1;
        else if (d.status === 'rolling') out.rolling += 1;
        else if (d.note) out.doubtful += 1;
      }
    },
  );
}

export function extractDeadlines(db: Database.Database, timeZone: string): DeadlineExtraction {
  const out: DeadlineExtraction = { checked: 0, confirmed: 0, rolling: 0, doubtful: 0 };
  drain(extractChunks(db, timeZone, out));
  return out;
}

/** Same as extractDeadlines, giving the event loop a turn between chunks of postings (CHUNK_SIZE). */
export async function extractDeadlinesAsync(
  db: Database.Database,
  timeZone: string,
  pause: () => Promise<void>,
): Promise<DeadlineExtraction> {
  const out: DeadlineExtraction = { checked: 0, confirmed: 0, rolling: 0, doubtful: 0 };
  await drainAsync(extractChunks(db, timeZone, out), pause);
  return out;
}
