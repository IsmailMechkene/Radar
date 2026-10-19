// Outreach drafts (SPEC section 9): templates with [merge fields] filled per organization, copied
// or opened in the user's mail app. Radar never sends anything. Pure helpers + small DB layer.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { listPipeline, type PipelineItem } from './db/pipeline';
import { utcTimestampSchema } from './db/schemas';

// ---------- merge fields ----------

/** "[first name]" -> "first name". Brackets with 1-40 word characters, spaces, apostrophes. */
const FIELD_RE = /\[([\p{L}\p{N}][\p{L}\p{N} '’-]{0,39})\]/gu;
export const fieldKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** Field names used in a text, in order of first use. */
export function fieldsIn(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(FIELD_RE)) seen.add(fieldKey(m[1]!));
  return [...seen];
}

export interface Rendered {
  subject: string;
  body: string;
  /** Fields with no value (still shown as [field]). */
  missing: string[];
}

export function render(
  subject: string,
  body: string,
  values: Readonly<Record<string, string>>,
): Rendered {
  const missing = new Set<string>();
  const fill = (t: string) =>
    t.replace(FIELD_RE, (whole, name: string) => {
      const v = values[fieldKey(name)]?.trim();
      if (v) return v;
      missing.add(fieldKey(name));
      return whole;
    });
  return { subject: fill(subject), body: fill(body), missing: [...missing] };
}

const TEAM_WORDS =
  /\b(team|recruit\w*|careers?|office|hr|form|admissions|talent|jobs?|committee|support|rh)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A first name from a contact like "Leila Martin"; nothing from "Talent team" or "L. Martin". */
export function firstNameOf(contact: string | null): string | null {
  if (!contact) return null;
  const c = contact.trim();
  if (TEAM_WORDS.test(c) || c.includes('@')) return null;
  const first = c.split(/\s+/)[0]!;
  return /^\p{Lu}[\p{L}'’-]{1,}$/u.test(first) && !first.endsWith('.') ? first : null;
}

/** Values Radar knows from the pipeline row; the user can override any of them. */
export function autoFields(row: PipelineItem, timeZone: string): Record<string, string> {
  const out: Record<string, string> = { company: row.org };
  const role = row.role ?? row.opportunity_title ?? row.program_name;
  if (role) out['role'] = role;
  const first = firstNameOf(row.contact_name);
  if (first) out['first name'] = first;
  if (row.contact_url && EMAIL_RE.test(row.contact_url.trim()))
    out['email'] = row.contact_url.trim();
  if (row.sent_at) {
    out['sent date'] = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      timeZone,
    }).format(new Date(row.sent_at));
  }
  return out;
}

/** mailto: link that opens a draft in the default mail app (nothing is sent). */
export function mailtoUrl(to: string, subject: string, body: string): string {
  const enc = (s: string) => encodeURIComponent(s);
  const recipient = EMAIL_RE.test(to.trim()) ? to.trim() : '';
  return `mailto:${recipient}?subject=${enc(subject)}&body=${enc(body.replace(/\r?\n/g, '\r\n'))}`;
}

// ---------- templates ----------

export const templateKindSchema = z.enum(['cold', 'followup']);
export const templateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  kind: templateKindSchema,
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

// Not strict: rows carry columns the page does not use (the sync UUID).
export const templateRowSchema = z.object({
  ...templateInputSchema.shape,
  id: z.int(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
});
export type TemplateRow = z.output<typeof templateRowSchema>;

export const DEFAULT_TEMPLATES: TemplateInput[] = [
  {
    name: 'Internship, cold email',
    kind: 'cold',
    subject: 'Summer 2027 internship, a student who builds with [product]',
    body: `Hi [first name],

I'm a computer engineering student at [my school] in Tunis. Over the last semester I've used [product] for [project], and it's the reason I'm writing.

I'd like to apply for the [role] position, starting summer 2027, remote or on-site. My school provides the internship agreement. Would your team at [company] consider an intern for this period, and is there someone I should talk to?

My CV and two short project write-ups are attached. Thank you for your time.

Best,
[my name]`,
  },
  {
    name: 'Follow-up',
    kind: 'followup',
    subject: 'Re: [role] position at [company]',
    body: `Hi [first name],

I'm following up on my email from [sent date] about the [role] position at [company]. I'm still very interested, and happy to share more about [project] or to have a short call at a time that suits you.

Thank you,
[my name]`,
  },
  {
    name: 'Candidature de stage (FR)',
    kind: 'cold',
    subject: 'Candidature de stage : [role]',
    body: `Bonjour [first name],

Étudiant en génie informatique à [my school] à Tunis, je souhaite postuler au poste de [role] chez [company], pour un stage à partir de l'été 2027. J'ai récemment travaillé sur [project], et votre travail sur [product] correspond exactement à ce que je veux approfondir.

Mon école fournit la convention de stage. Vous trouverez mon CV en pièce jointe ; je serais ravi d'échanger avec vous ou avec la personne en charge des stages.

Cordialement,
[my name]`,
  },
];

export function listTemplates(db: Database.Database): TemplateRow[] {
  return db
    .prepare('SELECT * FROM outreach_templates ORDER BY kind, id')
    .all()
    .map((r) => templateRowSchema.parse(r));
}

/** Inserts the default templates when there are none (first start). */
export function ensureDefaultTemplates(db: Database.Database, now: Date): number {
  const count = db.prepare('SELECT COUNT(*) FROM outreach_templates').pluck().get() as number;
  if (count > 0) return 0;
  const insert = db.prepare(
    'INSERT INTO outreach_templates (name, kind, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const t of DEFAULT_TEMPLATES)
      insert.run(t.name, t.kind, t.subject, t.body, now.toISOString(), now.toISOString());
  })();
  return DEFAULT_TEMPLATES.length;
}

export function saveTemplate(
  db: Database.Database,
  id: number | null,
  input: TemplateInput,
  now: Date,
): TemplateRow {
  const t = templateInputSchema.parse(input);
  const clash = db.prepare('SELECT id FROM outreach_templates WHERE name = ?').get(t.name) as
    { id: number } | undefined;
  if (clash && clash.id !== id) throw new Error(`A template named "${t.name}" already exists`);
  const iso = now.toISOString();
  const row =
    id === null
      ? db
          .prepare(
            'INSERT INTO outreach_templates (name, kind, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
          )
          .get(t.name, t.kind, t.subject, t.body, iso, iso)
      : db
          .prepare(
            'UPDATE outreach_templates SET name = ?, kind = ?, subject = ?, body = ?, updated_at = ? WHERE id = ? RETURNING *',
          )
          .get(t.name, t.kind, t.subject, t.body, iso, id);
  if (row === undefined) throw new Error(`No template with id ${id}`);
  return templateRowSchema.parse(row);
}

/** Deletes a template; the last one cannot go (drafts need something to start from). */
export function deleteTemplate(db: Database.Database, id: number): number {
  const count = db.prepare('SELECT COUNT(*) FROM outreach_templates').pluck().get() as number;
  if (count <= 1) throw new Error('Keep at least one template');
  return db.prepare('DELETE FROM outreach_templates WHERE id = ?').run(id).changes;
}

// ---------- drafts ----------

const fieldsSchema = z.record(z.string().trim().toLowerCase().min(1).max(60), z.string().max(2000));

export const draftInputSchema = z.strictObject({
  template_id: z.int().positive().nullable(),
  /** Only what the user typed; known values come from the pipeline row. */
  fields: fieldsSchema,
});
export type DraftInput = z.input<typeof draftInputSchema>;

export interface OutreachItem {
  row: PipelineItem;
  template_id: number | null;
  fields: Record<string, string>;
  /** Values Radar fills in from the pipeline row. */
  auto: Record<string, string>;
}

export function listOutreach(db: Database.Database, timeZone: string): OutreachItem[] {
  const drafts = new Map(
    (
      db.prepare('SELECT pipeline_id, template_id, fields_json FROM outreach_drafts').all() as {
        pipeline_id: number;
        template_id: number | null;
        fields_json: string;
      }[]
    ).map((d) => [d.pipeline_id, d]),
  );
  return listPipeline(db).map((row) => {
    const d = drafts.get(row.id);
    return {
      row,
      template_id: d?.template_id ?? null,
      fields: d ? fieldsSchema.parse(JSON.parse(d.fields_json)) : {},
      auto: autoFields(row, timeZone),
    };
  });
}

export function saveDraft(
  db: Database.Database,
  pipelineId: number,
  input: DraftInput,
  now: Date,
): void {
  const d = draftInputSchema.parse(input);
  if (!db.prepare('SELECT 1 FROM pipeline WHERE id = ?').get(pipelineId))
    throw new Error(`No pipeline row with id ${pipelineId}`);
  const fields = Object.fromEntries(Object.entries(d.fields).filter(([, v]) => v.trim() !== ''));
  db.prepare(
    `INSERT INTO outreach_drafts (pipeline_id, template_id, fields_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (pipeline_id) DO UPDATE SET template_id = excluded.template_id,
       fields_json = excluded.fields_json, updated_at = excluded.updated_at`,
  ).run(pipelineId, d.template_id, JSON.stringify(fields), now.toISOString());
}
