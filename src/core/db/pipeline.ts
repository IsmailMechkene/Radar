// Pipeline rows (SPEC section 9: Not started, Drafted, Sent, Follow-up sent, Interview, Rejected,
// Offer, Not eligible), with planned send date, sent date and automatic follow-up dates.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { followupDates } from '../reminders/plan';
import { utcTimestampSchema } from './schemas';

export const PIPELINE_STATUSES = [
  'not_started',
  'drafted',
  'sent',
  'followup_sent',
  'interview',
  'rejected',
  'offer',
  'not_eligible',
] as const;
export const pipelineStatusSchema = z.enum(PIPELINE_STATUSES);
export type PipelineStatus = z.output<typeof pipelineStatusSchema>;

/** Local calendar date, e.g. "2026-10-19" (planned send dates have no time). */
export const localDateSchema = z.iso.date();

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();

/** Editable fields. Strings are trimmed; an empty string clears the field. */
export const pipelinePatchSchema = z.strictObject({
  org: z.string().trim().min(1).max(200).optional(),
  role: text(300).optional(),
  status: pipelineStatusSchema.optional(),
  planned_send_date: localDateSchema.nullable().optional(),
  sent_at: utcTimestampSchema.nullable().optional(),
  contact_name: text(200).optional(),
  contact_url: text(500).optional(),
  notes: text(4000).optional(),
});
export type PipelinePatch = z.input<typeof pipelinePatchSchema>;

export const pipelineNewSchema = pipelinePatchSchema.extend({
  org: z.string().trim().min(1).max(200),
});
export type PipelineNew = z.input<typeof pipelineNewSchema>;

export const pipelineRowSchema = z.object({
  id: z.int(),
  opportunity_id: z.int().nullable(),
  program_id: z.int().nullable(),
  org: z.string(),
  role: z.string().nullable(),
  status: pipelineStatusSchema,
  planned_send_date: localDateSchema.nullable(),
  sent_at: utcTimestampSchema.nullable(),
  followup1_at: utcTimestampSchema.nullable(),
  followup2_at: utcTimestampSchema.nullable(),
  contact_name: z.string().nullable(),
  contact_url: z.string().nullable(),
  notes: z.string().nullable(),
  updated_at: utcTimestampSchema,
});
export type PipelineRow = z.output<typeof pipelineRowSchema>;

/** A row as the Pipeline page shows it: the role falls back to the linked posting or program. */
export const pipelineItemSchema = pipelineRowSchema.extend({
  opportunity_title: z.string().nullable(),
  opportunity_url: z.string().nullable(),
  program_name: z.string().nullable(),
});
export type PipelineItem = z.output<typeof pipelineItemSchema>;

/**
 * A follow-up is due once its date passed while the row still waits for an answer: the first
 * while Sent, the second while Sent or Follow-up sent.
 */
export function followupDue(
  i: Pick<PipelineRow, 'status' | 'followup1_at' | 'followup2_at'>,
  now: Date,
): boolean {
  const passed = (at: string | null) => at !== null && new Date(at).getTime() <= now.getTime();
  return (
    (i.status === 'sent' && passed(i.followup1_at)) ||
    ((i.status === 'sent' || i.status === 'followup_sent') && passed(i.followup2_at))
  );
}

export function listPipeline(db: Database.Database): PipelineItem[] {
  return db
    .prepare(
      `SELECT p.*, o.title AS opportunity_title, o.url AS opportunity_url, g.name AS program_name
         FROM pipeline p
         LEFT JOIN opportunities o ON o.id = p.opportunity_id
         LEFT JOIN programs g ON g.id = p.program_id
        ORDER BY COALESCE(p.planned_send_date, '9999-12-31'), p.org COLLATE NOCASE, p.id`,
    )
    .all()
    .map((r) => pipelineItemSchema.parse(r));
}

function getRow(db: Database.Database, id: number): PipelineRow {
  const row = db.prepare('SELECT * FROM pipeline WHERE id = ?').get(id);
  if (row === undefined) throw new Error(`No pipeline row with id ${id}`);
  return pipelineRowSchema.parse(row);
}

export function getPipelineItem(db: Database.Database, id: number): PipelineItem {
  const item = listPipeline(db).find((r) => r.id === id);
  if (!item) throw new Error(`No pipeline row with id ${id}`);
  return item;
}

/**
 * Applies a patch. Marking a row Sent without a sent date sets it to now; whenever the sent date
 * changes, the follow-ups are recomputed (+7 and +14 days, 09:00 local), or cleared with it.
 */
export function updatePipelineRow(
  db: Database.Database,
  id: number,
  patch: PipelinePatch,
  timeZone: string,
  now: Date,
): PipelineItem {
  const p = pipelinePatchSchema.parse(patch);
  return db.transaction((): PipelineItem => {
    const before = getRow(db, id);
    const next = { ...before, ...p } as PipelineRow;
    if (p.status === 'sent' && p.sent_at === undefined && before.sent_at === null) {
      next.sent_at = now.toISOString();
    }
    if (next.sent_at !== before.sent_at) {
      const [f1, f2] = next.sent_at ? followupDates(next.sent_at, timeZone) : [null, null];
      next.followup1_at = f1;
      next.followup2_at = f2;
    }
    db.prepare(
      `UPDATE pipeline SET org = @org, role = @role, status = @status,
         planned_send_date = @planned_send_date, sent_at = @sent_at, followup1_at = @followup1_at,
         followup2_at = @followup2_at, contact_name = @contact_name, contact_url = @contact_url,
         notes = @notes, updated_at = @updated_at
       WHERE id = @id`,
    ).run({ ...next, updated_at: now.toISOString() });
    return getPipelineItem(db, id);
  })();
}

/** Creates a row not linked to a scanned posting (status defaults to Not started). */
export function createPipelineRow(
  db: Database.Database,
  input: PipelineNew,
  timeZone: string,
  now: Date,
): PipelineItem {
  const p = pipelineNewSchema.parse(input);
  return db.transaction((): PipelineItem => {
    const { id } = db
      .prepare(
        `INSERT INTO pipeline (org, status, updated_at) VALUES (?, 'not_started', ?) RETURNING id`,
      )
      .get(p.org, now.toISOString()) as { id: number };
    const { org: _org, ...rest } = p;
    return updatePipelineRow(db, id, rest, timeZone, now);
  })();
}

/** Adds opportunities to the pipeline as "Not started". Opportunities already there are skipped. */
export function addOpportunitiesToPipeline(
  db: Database.Database,
  opportunityIds: readonly number[],
  now: Date,
): AddToPipelineResult {
  const exists = db.prepare('SELECT 1 FROM pipeline WHERE opportunity_id = ?');
  const org = db.prepare('SELECT org FROM opportunities WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO pipeline (opportunity_id, org, status, updated_at)
     VALUES (?, ?, 'not_started', ?) RETURNING id`,
  );
  return db.transaction((): AddToPipelineResult => {
    const added: number[] = [];
    let skipped = 0;
    for (const id of new Set(opportunityIds)) {
      if (exists.get(id)) {
        skipped += 1;
        continue;
      }
      const row = org.get(id) as { org: string } | undefined;
      if (!row) throw new Error(`No opportunity with id ${id}`);
      const { id: pipelineId } = insert.get(id, row.org, now.toISOString()) as { id: number };
      added.push(pipelineId);
    }
    return { added, skipped };
  })();
}

export interface AddToPipelineResult {
  /** New pipeline row ids (for Undo). */
  added: number[];
  /** Opportunities that were already in the pipeline. */
  skipped: number;
}

/** Deletes pipeline rows by id (Undo of an add, or delete). Their reminders go with them. */
export function removePipelineRows(db: Database.Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  const list = ids.map(() => '?').join(', ');
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM reminders WHERE target_type = 'pipeline' AND target_id IN (${list})`,
    ).run(...ids);
    return db.prepare(`DELETE FROM pipeline WHERE id IN (${list})`).run(...ids).changes;
  })();
}
