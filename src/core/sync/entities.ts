// What each synced row looks like on the wire, how it is read for upload, and how a pulled one is
// written here. Rows are addressed by UUID (settings by key, rules by 'rules', drafts by their
// pipeline row's UUID). Pulled payloads are validated with zod before anything is written.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { localDateSchema, pipelineStatusSchema, removePipelineRows } from '../db/pipeline';
import { utcTimestampSchema } from '../db/schemas';
import { removeManualDeadline } from '../deadlines/list';
import { deleteProgram, setWatchedPage } from '../programs/manage';
import { settingsSchema, type SettingKey } from '../settings/schema';
import { dropChange, pendingChange, queueChange } from './state';

/** Parents first: a pipeline row names its program, a draft its pipeline row and template. */
export const ENTITIES = [
  'source',
  'program',
  'template',
  'pipeline',
  'draft',
  'manual',
  'review',
  'cv',
  'rules',
  'setting',
] as const;
export type Entity = (typeof ENTITIES)[number];

/** Settings that follow the account (migration 15 lists the same keys in its trigger). The rest
 * belong to one computer: theme, autostart, backup folder, and internal timestamps. */
export const SYNCED_SETTINGS = [
  'timezone',
  'searchMode',
  'rolesOfInterest',
  'targetRegions',
  'remotePreference',
  'grade',
  'quietHours',
  'matchAlerts',
  'scanIntervalHours',
  'outreachDefaults',
  'masterCv',
] as const satisfies readonly SettingKey[];

export interface ApplyContext {
  now: Date;
  /** When the pulled version was written (last writer wins). */
  changedAt: string;
}

/** applied: written here; kept: this device's copy stays (newer, or one that cannot be removed). */
export type ApplyResult = 'applied' | 'kept';

const nullableText = z.string().nullable();
const ts = utcTimestampSchema;
const jsonText = z.string().refine((s) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}, 'expected JSON text');

const sourceRow = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  url: nullableText,
  config_json: jsonText,
  access_method: z.enum(['api', 'rss', 'public_html', 'email_alert', 'manual']),
  tos_note: nullableText,
  paused: z.union([z.literal(0), z.literal(1)]),
  created_at: ts,
});
const programRow = z.object({
  name: z.string().min(1),
  org: nullableText,
  url: nullableText,
  status: z.enum(['watching', 'open', 'applied', 'closed', 'not_applicable']),
  deadline_status: z.enum(['confirmed', 'expected', 'rolling', 'unknown', 'closed']),
  typical_open: nullableText,
  typical_deadline: nullableText,
  notes: nullableText,
  expected_open_at: ts.nullable(),
  expected_deadline_at: ts.nullable(),
  edited_at: ts.nullable(),
  seeded: z.union([z.literal(0), z.literal(1)]),
});
const templateRow = z.object({
  name: z.string().min(1),
  kind: z.enum(['cold', 'followup']),
  subject: z.string(),
  body: z.string(),
  created_at: ts,
  updated_at: ts,
});
const pipelineRow = z.object({
  opportunity_key: nullableText,
  /** The posting's title, shown as the role where this device has not seen the posting. */
  opportunity_title: nullableText,
  program: nullableText,
  org: z.string().min(1),
  role: nullableText,
  status: pipelineStatusSchema,
  planned_send_date: localDateSchema.nullable(),
  sent_at: ts.nullable(),
  followup1_at: ts.nullable(),
  followup2_at: ts.nullable(),
  contact_name: nullableText,
  contact_url: nullableText,
  notes: nullableText,
  updated_at: ts,
});
const draftRow = z.object({
  template: z.uuid().nullable(),
  fields_json: jsonText,
  updated_at: ts,
});
const manualRow = z.object({
  title: z.string().min(1),
  org: nullableText,
  deadline_at: ts,
  url: nullableText,
  notes: nullableText,
  created_at: ts,
});
const reviewRow = z.object({
  score: z.number().min(0).max(5),
  review_json: jsonText,
  model: z.string(),
  cost_usd: z.number().nullable(),
  reviewed_at: ts,
});
const cvRow = z.object({
  cv_json: jsonText,
  model: z.string(),
  cost_usd: z.number().nullable(),
  created_at: ts,
});
const rulesRow = z.object({ rules_json: jsonText, updated_at: ts });
const settingRow = z.object({ value: z.unknown() });

const idOf = (db: Database.Database, table: string, uuid: string): number | null =>
  (db.prepare(`SELECT id FROM ${table} WHERE uuid = ?`).pluck().get(uuid) as number | undefined) ??
  null;

/**
 * The same row can exist here under another UUID (a default template, a seeded program edited on
 * two devices, the same posting added on both). It stays one row: the smaller UUID wins on every
 * device, the other is deleted from the account, and the newer content is kept.
 * Returns the local row to write (null: insert a new one) and whether the pulled content applies.
 */
function claim(
  db: Database.Database,
  table: string,
  entity: Entity,
  uuid: string,
  natural: { id: number; uuid: string } | undefined,
  ctx: ApplyContext,
): { id: number | null; apply: boolean } {
  const own = idOf(db, table, uuid);
  if (own !== null) return { id: own, apply: true };
  if (!natural) return { id: null, apply: true };
  const local = pendingChange(db, entity, natural.uuid);
  const localNewer = local !== null && !local.deleted && local.changed_at > ctx.changedAt;
  const now = ctx.now.toISOString();
  if (uuid < natural.uuid) {
    db.prepare(`UPDATE ${table} SET uuid = ? WHERE id = ?`).run(uuid, natural.id);
    dropChange(db, entity, natural.uuid);
    if (localNewer) queueChange(db, entity, uuid, false, local.changed_at);
    queueChange(db, entity, natural.uuid, true, now);
  } else {
    queueChange(db, entity, natural.uuid, false, localNewer ? local.changed_at : ctx.changedAt);
    queueChange(db, entity, uuid, true, now);
  }
  return { id: natural.id, apply: !localNewer };
}

interface Spec<R> {
  schema: z.ZodType<R>;
  read(db: Database.Database, key: string): R | null;
  upsert(db: Database.Database, key: string, row: R, ctx: ApplyContext): ApplyResult;
  remove(db: Database.Database, key: string, ctx: ApplyContext): ApplyResult;
}

const source: Spec<z.output<typeof sourceRow>> = {
  schema: sourceRow,
  read: (db, key) =>
    (db
      .prepare(
        `SELECT kind, name, url, config_json, access_method, tos_note, paused, created_at
           FROM sources WHERE uuid = ? AND added_by_user = 1`,
      )
      .get(key) as z.output<typeof sourceRow> | undefined) ?? null,
  upsert(db, key, row, ctx) {
    const natural = db
      .prepare('SELECT id, uuid, added_by_user FROM sources WHERE kind = ? AND name = ?')
      .get(row.kind, row.name) as { id: number; uuid: string; added_by_user: number } | undefined;
    // A board this device ships as a seed: it is here already.
    if (natural && !natural.added_by_user && natural.uuid !== key) return 'kept';
    const target = claim(db, 'sources', 'source', key, natural, ctx);
    if (!target.apply) return 'kept';
    const values = { ...row, uuid: key, id: target.id };
    if (target.id === null) {
      db.prepare(
        `INSERT INTO sources (uuid, kind, name, url, config_json, access_method, tos_note, enabled,
           paused, added_by_user, created_at)
         VALUES (@uuid, @kind, @name, @url, @config_json, @access_method, @tos_note, 1, @paused, 1,
           @created_at)`,
      ).run(values);
    } else {
      db.prepare(
        `UPDATE sources SET kind = @kind, name = @name, url = @url, config_json = @config_json,
           access_method = @access_method, tos_note = @tos_note, paused = @paused, added_by_user = 1
         WHERE id = @id`,
      ).run(values);
    }
    return 'applied';
  },
  remove(db, key) {
    const id = idOf(db, 'sources', key);
    if (id === null) return 'applied';
    const used = db
      .prepare('SELECT COUNT(*) FROM opportunity_sources WHERE source_id = ?')
      .pluck()
      .get(id) as number;
    if (used > 0) {
      // Postings found here keep their source: paused, as deleting one by hand would suggest.
      db.prepare('UPDATE sources SET paused = 1 WHERE id = ?').run(id);
      return 'kept';
    }
    db.prepare('UPDATE programs SET source_id = NULL WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    return 'applied';
  },
};

const program: Spec<z.output<typeof programRow>> = {
  schema: programRow,
  read: (db, key) =>
    (db
      .prepare(
        `SELECT name, org, url, status, deadline_status, typical_open, typical_deadline, notes,
           expected_open_at, expected_deadline_at, edited_at, seeded
           FROM programs WHERE uuid = ? AND (seeded = 0 OR edited_at IS NOT NULL)`,
      )
      .get(key) as z.output<typeof programRow> | undefined) ?? null,
  upsert(db, key, row, ctx) {
    const natural = db.prepare('SELECT id, uuid FROM programs WHERE name = ?').get(row.name) as
      { id: number; uuid: string } | undefined;
    const target = claim(db, 'programs', 'program', key, natural, ctx);
    if (!target.apply) return 'kept';
    const values = { ...row, uuid: key, id: target.id, now: ctx.now.toISOString() };
    let id = target.id;
    if (id === null) {
      id = (
        db
          .prepare(
            `INSERT INTO programs (uuid, name, org, url, status, deadline_status, typical_open,
               typical_deadline, notes, expected_open_at, expected_deadline_at, edited_at, seeded,
               next_check_at)
             VALUES (@uuid, @name, @org, @url, @status, @deadline_status, @typical_open,
               @typical_deadline, @notes, @expected_open_at, @expected_deadline_at, @edited_at,
               @seeded, @now)
             RETURNING id`,
          )
          .get(values) as { id: number }
      ).id;
    } else {
      // A program this device seeds stays seeded here (it cannot be deleted, it comes back).
      db.prepare(
        `UPDATE programs SET name = @name, org = @org, url = @url, status = @status,
           deadline_status = @deadline_status, typical_open = @typical_open,
           typical_deadline = @typical_deadline, notes = @notes,
           expected_open_at = @expected_open_at, expected_deadline_at = @expected_deadline_at,
           edited_at = @edited_at, seeded = MAX(seeded, @seeded)
         WHERE id = @id`,
      ).run(values);
    }
    setWatchedPage(db, id, row.name, row.url, ctx.now);
    return 'applied';
  },
  remove(db, key) {
    const row = db.prepare('SELECT id, seeded FROM programs WHERE uuid = ?').get(key) as
      { id: number; seeded: number } | undefined;
    if (!row) return 'applied';
    if (row.seeded) return 'kept'; // seeded here: it would come back at the next start
    deleteProgram(db, row.id);
    return 'applied';
  },
};

const template: Spec<z.output<typeof templateRow>> = {
  schema: templateRow,
  read: (db, key) =>
    (db
      .prepare(
        'SELECT name, kind, subject, body, created_at, updated_at FROM outreach_templates WHERE uuid = ?',
      )
      .get(key) as z.output<typeof templateRow> | undefined) ?? null,
  upsert(db, key, row, ctx) {
    const natural = db
      .prepare('SELECT id, uuid FROM outreach_templates WHERE name = ?')
      .get(row.name) as { id: number; uuid: string } | undefined;
    const target = claim(db, 'outreach_templates', 'template', key, natural, ctx);
    if (!target.apply) return 'kept';
    const values = { ...row, uuid: key, id: target.id };
    if (target.id === null) {
      db.prepare(
        `INSERT INTO outreach_templates (uuid, name, kind, subject, body, created_at, updated_at)
         VALUES (@uuid, @name, @kind, @subject, @body, @created_at, @updated_at)`,
      ).run(values);
    } else {
      db.prepare(
        `UPDATE outreach_templates SET name = @name, kind = @kind, subject = @subject, body = @body,
           updated_at = @updated_at WHERE id = @id`,
      ).run(values);
    }
    return 'applied';
  },
  remove(db, key) {
    db.prepare('DELETE FROM outreach_templates WHERE uuid = ?').run(key);
    return 'applied';
  },
};

const pipeline: Spec<z.output<typeof pipelineRow>> = {
  schema: pipelineRow,
  read: (db, key) =>
    (db
      .prepare(
        `SELECT p.opportunity_key, o.title AS opportunity_title, g.name AS program, p.org, p.role,
           p.status, p.planned_send_date, p.sent_at, p.followup1_at, p.followup2_at,
           p.contact_name, p.contact_url, p.notes, p.updated_at
           FROM pipeline p
           LEFT JOIN opportunities o ON o.id = p.opportunity_id
           LEFT JOIN programs g ON g.id = p.program_id
          WHERE p.uuid = ?`,
      )
      .get(key) as z.output<typeof pipelineRow> | undefined) ?? null,
  upsert(db, key, row, ctx) {
    const natural =
      row.opportunity_key === null
        ? undefined
        : (db
            .prepare('SELECT id, uuid FROM pipeline WHERE opportunity_key = ? ORDER BY id LIMIT 1')
            .get(row.opportunity_key) as { id: number; uuid: string } | undefined);
    const target = claim(db, 'pipeline', 'pipeline', key, natural, ctx);
    if (!target.apply) return 'kept';
    const opportunityId =
      row.opportunity_key === null
        ? null
        : ((db
            .prepare('SELECT id FROM opportunities WHERE dedupe_key = ?')
            .pluck()
            .get(row.opportunity_key) as number | undefined) ?? null);
    const programId =
      row.program === null
        ? null
        : ((db.prepare('SELECT id FROM programs WHERE name = ?').pluck().get(row.program) as
            number | undefined) ?? null);
    const values = {
      ...row,
      uuid: key,
      id: target.id,
      opportunity_id: opportunityId,
      program_id: programId,
      role: row.role ?? (opportunityId === null ? row.opportunity_title : null),
    };
    if (target.id === null) {
      db.prepare(
        `INSERT INTO pipeline (uuid, opportunity_id, opportunity_key, program_id, org, role, status,
           planned_send_date, sent_at, followup1_at, followup2_at, contact_name, contact_url, notes,
           updated_at)
         VALUES (@uuid, @opportunity_id, @opportunity_key, @program_id, @org, @role, @status,
           @planned_send_date, @sent_at, @followup1_at, @followup2_at, @contact_name, @contact_url,
           @notes, @updated_at)`,
      ).run(values);
    } else {
      db.prepare(
        `UPDATE pipeline SET opportunity_id = @opportunity_id, opportunity_key = @opportunity_key,
           program_id = @program_id, org = @org, role = @role, status = @status,
           planned_send_date = @planned_send_date, sent_at = @sent_at,
           followup1_at = @followup1_at, followup2_at = @followup2_at,
           contact_name = @contact_name, contact_url = @contact_url, notes = @notes,
           updated_at = @updated_at
         WHERE id = @id`,
      ).run(values);
    }
    return 'applied';
  },
  remove(db, key) {
    const id = idOf(db, 'pipeline', key);
    if (id !== null) removePipelineRows(db, [id]);
    return 'applied';
  },
};

const draft: Spec<z.output<typeof draftRow>> = {
  schema: draftRow,
  read: (db, key) =>
    (db
      .prepare(
        `SELECT t.uuid AS template, d.fields_json, d.updated_at
           FROM outreach_drafts d
           JOIN pipeline p ON p.id = d.pipeline_id
           LEFT JOIN outreach_templates t ON t.id = d.template_id
          WHERE p.uuid = ?`,
      )
      .get(key) as z.output<typeof draftRow> | undefined) ?? null,
  upsert(db, key, row) {
    const pipelineId = idOf(db, 'pipeline', key);
    if (pipelineId === null) return 'kept'; // its pipeline row was deleted here
    const templateId = row.template === null ? null : idOf(db, 'outreach_templates', row.template);
    db.prepare(
      `INSERT INTO outreach_drafts (pipeline_id, template_id, fields_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (pipeline_id) DO UPDATE SET template_id = excluded.template_id,
         fields_json = excluded.fields_json, updated_at = excluded.updated_at`,
    ).run(pipelineId, templateId, row.fields_json, row.updated_at);
    return 'applied';
  },
  remove(db, key) {
    db.prepare(
      'DELETE FROM outreach_drafts WHERE pipeline_id = (SELECT id FROM pipeline WHERE uuid = ?)',
    ).run(key);
    return 'applied';
  },
};

const manual: Spec<z.output<typeof manualRow>> = {
  schema: manualRow,
  read: (db, key) =>
    (db
      .prepare(
        'SELECT title, org, deadline_at, url, notes, created_at FROM manual_deadlines WHERE uuid = ?',
      )
      .get(key) as z.output<typeof manualRow> | undefined) ?? null,
  upsert(db, key, row) {
    const id = idOf(db, 'manual_deadlines', key);
    if (id === null) {
      db.prepare(
        `INSERT INTO manual_deadlines (uuid, title, org, deadline_at, url, notes, created_at)
         VALUES (@uuid, @title, @org, @deadline_at, @url, @notes, @created_at)`,
      ).run({ ...row, uuid: key });
    } else {
      db.prepare(
        `UPDATE manual_deadlines SET title = @title, org = @org, deadline_at = @deadline_at,
           url = @url, notes = @notes WHERE id = @id`,
      ).run({ ...row, id });
    }
    return 'applied';
  },
  remove(db, key) {
    const id = idOf(db, 'manual_deadlines', key);
    if (id !== null) removeManualDeadline(db, id);
    return 'applied';
  },
};

/** Keyed by the posting's dedupe key: it shows once this device has (or finds) the posting. */
const review: Spec<z.output<typeof reviewRow>> = {
  schema: reviewRow,
  read: (db, key) =>
    (db
      .prepare(
        `SELECT score, review_json, model, cost_usd, reviewed_at FROM copilot_reviews
          WHERE opportunity_key = ?`,
      )
      .get(key) as z.output<typeof reviewRow> | undefined) ?? null,
  upsert(db, key, row) {
    // Stored as sent: a review this Radar cannot read is reported on the page, not lost.
    db.prepare(
      `INSERT INTO copilot_reviews (opportunity_key, score, review_json, model, cost_usd, reviewed_at)
       VALUES (@key, @score, @review_json, @model, @cost_usd, @reviewed_at)
       ON CONFLICT (opportunity_key) DO UPDATE SET score = excluded.score,
         review_json = excluded.review_json, model = excluded.model, cost_usd = excluded.cost_usd,
         reviewed_at = excluded.reviewed_at`,
    ).run({ ...row, key });
    return 'applied';
  },
  remove(db, key) {
    db.prepare('DELETE FROM copilot_reviews WHERE opportunity_key = ?').run(key);
    return 'applied';
  },
};

/** Tailored CVs, keyed like reviews. */
const cv: Spec<z.output<typeof cvRow>> = {
  schema: cvRow,
  read: (db, key) =>
    (db
      .prepare(
        'SELECT cv_json, model, cost_usd, created_at FROM copilot_cvs WHERE opportunity_key = ?',
      )
      .get(key) as z.output<typeof cvRow> | undefined) ?? null,
  upsert(db, key, row) {
    // Stored as sent: a CV this Radar cannot read is reported on the page, not lost.
    db.prepare(
      `INSERT INTO copilot_cvs (opportunity_key, cv_json, model, cost_usd, created_at)
       VALUES (@key, @cv_json, @model, @cost_usd, @created_at)
       ON CONFLICT (opportunity_key) DO UPDATE SET cv_json = excluded.cv_json,
         model = excluded.model, cost_usd = excluded.cost_usd, created_at = excluded.created_at`,
    ).run({ ...row, key });
    return 'applied';
  },
  remove(db, key) {
    db.prepare('DELETE FROM copilot_cvs WHERE opportunity_key = ?').run(key);
    return 'applied';
  },
};

const rules: Spec<z.output<typeof rulesRow>> = {
  schema: rulesRow,
  read: (db) =>
    (db.prepare('SELECT rules_json, updated_at FROM user_rules WHERE id = 1').get() as
      z.output<typeof rulesRow> | undefined) ?? null,
  upsert(db, _key, row) {
    // Stored as sent: a version this Radar cannot read is reported by effectiveRules, not lost.
    db.prepare(
      `INSERT INTO user_rules (id, rules_json, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO UPDATE SET rules_json = excluded.rules_json, updated_at = excluded.updated_at`,
    ).run(row.rules_json, row.updated_at);
    return 'applied';
  },
  remove(db) {
    db.prepare('DELETE FROM user_rules WHERE id = 1').run();
    return 'applied';
  },
};

const isSyncedSetting = (key: string): key is (typeof SYNCED_SETTINGS)[number] =>
  (SYNCED_SETTINGS as readonly string[]).includes(key);

const setting: Spec<z.output<typeof settingRow>> = {
  schema: settingRow,
  read(db, key) {
    if (!isSyncedSetting(key)) return null;
    const json = db.prepare('SELECT value_json FROM settings WHERE key = ?').pluck().get(key) as
      string | undefined;
    return json === undefined ? null : { value: JSON.parse(json) as unknown };
  },
  upsert(db, key, row) {
    if (!isSyncedSetting(key)) throw new Error(`Setting "${key}" does not sync`);
    const value = settingsSchema.shape[key].parse(row.value);
    db.prepare(
      `INSERT INTO settings (key, value_json) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    ).run(key, JSON.stringify(value));
    return 'applied';
  },
  remove: () => 'kept', // settings are never deleted
};

const SPECS: Record<Entity, Spec<unknown>> = {
  source,
  program,
  template,
  pipeline,
  draft,
  manual,
  review,
  cv,
  rules,
  setting,
} as Record<Entity, Spec<unknown>>;

export const isEntity = (e: string): e is Entity => (ENTITIES as readonly string[]).includes(e);

/** The row as it is uploaded; null when it no longer exists or no longer syncs. */
export function readRow(db: Database.Database, entity: Entity, key: string): unknown {
  return SPECS[entity].read(db, key);
}

/** Writes a pulled row (null: a deletion). Throws on a payload that does not validate. */
export function applyRow(
  db: Database.Database,
  entity: Entity,
  key: string,
  row: unknown,
  ctx: ApplyContext,
): ApplyResult {
  const spec = SPECS[entity];
  if (row === null) return spec.remove(db, key, ctx);
  return spec.upsert(db, key, spec.schema.parse(row), ctx);
}

/** Links pipeline rows to postings that this device has found since (by dedupe key). */
export function relinkPipeline(db: Database.Database): number {
  return db
    .prepare(
      `UPDATE pipeline SET opportunity_id =
         (SELECT id FROM opportunities WHERE dedupe_key = pipeline.opportunity_key)
       WHERE opportunity_id IS NULL AND opportunity_key IS NOT NULL
         AND EXISTS (SELECT 1 FROM opportunities WHERE dedupe_key = pipeline.opportunity_key)`,
    )
    .run().changes;
}
