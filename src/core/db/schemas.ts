import { z } from 'zod';

// Enums shared by the DB CHECK constraints (see migrations/001_init.ts).
export const accessMethodSchema = z.enum(['api', 'rss', 'public_html', 'email_alert', 'manual']);
export const opportunityTypeSchema = z.enum(['internship', 'pfe', 'junior', 'fulltime', 'program']);
export const languageSchema = z.enum(['en', 'fr', 'other', 'unknown']);
export const remoteTypeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown']);
export const deadlineStatusSchema = z.enum([
  'confirmed',
  'expected',
  'rolling',
  'unknown',
  'closed',
]);
export const verdictSchema = z.enum(['apply', 'maybe', 'needs_review', 'skip']);

/** UTC ISO-8601 timestamp ending in Z. */
export const utcTimestampSchema = z.iso.datetime();

const sqliteBool = z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1);

export const sourceRowSchema = z.object({
  id: z.int(),
  kind: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  config_json: z.string(),
  access_method: accessMethodSchema,
  tos_note: z.string().nullable(),
  enabled: sqliteBool,
  last_ok_at: utcTimestampSchema.nullable(),
  last_error: z.string().nullable(),
  consecutive_empty: z.int(),
  created_at: utcTimestampSchema,
});
export type SourceRow = z.output<typeof sourceRowSchema>;

export const sourceInputSchema = z.object({
  kind: z.string().trim().min(1),
  name: z.string().trim().min(1),
  url: z.url().nullable().default(null),
  config: z.record(z.string(), z.unknown()).default({}),
  access_method: accessMethodSchema,
  tos_note: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});
export type SourceInput = z.input<typeof sourceInputSchema>;

export const opportunityRowSchema = z.object({
  id: z.int(),
  dedupe_key: z.string(),
  source_id: z.int(),
  org: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  remote_type: remoteTypeSchema,
  opportunity_type: opportunityTypeSchema,
  language: languageSchema,
  url: z.string(),
  apply_url: z.string().nullable(),
  description: z.string().nullable(),
  posted_at: utcTimestampSchema.nullable(),
  deadline_at: utcTimestampSchema.nullable(),
  deadline_status: deadlineStatusSchema,
  eligibility_notes: z.string().nullable(),
  score: z.number().nullable(),
  score_breakdown_json: z.string().nullable(),
  verdict: verdictSchema.nullable(),
  first_seen_at: utcTimestampSchema,
  last_seen_at: utcTimestampSchema,
  closed_at: utcTimestampSchema.nullable(),
});
export type OpportunityRow = z.output<typeof opportunityRowSchema>;

/** What a scan produces for one posting. Scoring fields are set later by the rules engine. */
export const opportunityInputSchema = z.object({
  dedupe_key: z.string().trim().min(1),
  source_id: z.int().positive(),
  org: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().nullable().default(null),
  remote_type: remoteTypeSchema.default('unknown'),
  opportunity_type: opportunityTypeSchema,
  language: languageSchema.default('unknown'),
  url: z.url(),
  apply_url: z.url().nullable().default(null),
  description: z.string().nullable().default(null),
  posted_at: utcTimestampSchema.nullable().default(null),
  deadline_at: utcTimestampSchema.nullable().default(null),
  deadline_status: deadlineStatusSchema.default('unknown'),
  eligibility_notes: z.string().nullable().default(null),
});
export type OpportunityInput = z.input<typeof opportunityInputSchema>;

export const opportunitySourceRowSchema = z.object({
  opportunity_id: z.int(),
  source_id: z.int(),
  url: z.string(),
  first_seen_at: utcTimestampSchema,
  last_seen_at: utcTimestampSchema,
});
export type OpportunitySourceRow = z.output<typeof opportunitySourceRowSchema>;
