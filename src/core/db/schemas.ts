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
  starred: sqliteBool,
  dismissed_at: utcTimestampSchema.nullable(),
  deadline_text: z.string().nullable(),
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
  /** The sentence the deadline was parsed from, quoted in the UI. */
  deadline_text: z.string().nullable().default(null),
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

/**
 * Explainable score (SPEC section 6). Written by the rules engine into score_breakdown_json;
 * the UI shows every signal as a bar. `summary` is the one-line reason shown under a row title.
 */
export const scoreSignalSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  detail: z.string(),
  /** Positive for matches, negative for penalties. */
  points: z.number(),
});
export const scoreBreakdownSchema = z.object({
  version: z.literal(1),
  summary: z.string(),
  signals: z.array(scoreSignalSchema),
});
export type ScoreSignal = z.output<typeof scoreSignalSchema>;
export type ScoreBreakdown = z.output<typeof scoreBreakdownSchema>;

/** Parses stored breakdown JSON; a malformed value is an error, never silently ignored. */
export function parseBreakdown(json: string | null): ScoreBreakdown | null {
  if (json === null) return null;
  return scoreBreakdownSchema.parse(JSON.parse(json));
}

/** One table row: what the Opportunities list needs, nothing more (no full breakdown). */
export const opportunityListItemSchema = z
  .object({
    id: z.int(),
    org: z.string(),
    title: z.string(),
    location: z.string().nullable(),
    remote_type: remoteTypeSchema,
    opportunity_type: opportunityTypeSchema,
    url: z.string(),
    apply_url: z.string().nullable(),
    description: z.string().nullable(),
    posted_at: utcTimestampSchema.nullable(),
    deadline_at: utcTimestampSchema.nullable(),
    deadline_status: deadlineStatusSchema,
    score: z.number().nullable(),
    verdict: verdictSchema.nullable(),
    score_breakdown_json: z.string().nullable(),
    starred: sqliteBool,
    first_seen_at: utcTimestampSchema,
    source_name: z.string(),
    source_kind: z.string(),
    source_access_method: accessMethodSchema,
    source_count: z.int(),
  })
  .transform(({ score_breakdown_json, ...rest }) => ({
    ...rest,
    summary: parseBreakdown(score_breakdown_json)?.summary ?? null,
  }));
export type OpportunityListItem = z.output<typeof opportunityListItemSchema>;

export const opportunitySourceLinkSchema = z.object({
  source_id: z.int(),
  name: z.string(),
  access_method: accessMethodSchema,
  url: z.string(),
  first_seen_at: utcTimestampSchema,
});
export type OpportunitySourceLink = z.output<typeof opportunitySourceLinkSchema>;

/** Everything the detail drawer shows. */
export type OpportunityDetail = Omit<OpportunityRow, 'score_breakdown_json'> & {
  breakdown: ScoreBreakdown | null;
  sources: OpportunitySourceLink[];
};
