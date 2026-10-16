// Adapter contract: every source turns its payload into validated RawItems. A bad item never
// throws; it is skipped and reported in `errors` so the runner can log it (SPEC section 12).
import { z } from 'zod';
import type { HttpClient } from '../http/client';

export const remoteTypeSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export type RemoteType = z.output<typeof remoteTypeSchema>;

/** Wider than the DB enum: adapters may not know; the runner decides what to store. */
export const opportunityTypeGuessSchema = z.enum([
  'internship',
  'pfe',
  'junior',
  'fulltime',
  'program',
  'unknown',
]);
export type OpportunityTypeGuess = z.output<typeof opportunityTypeGuessSchema>;

export const languageSchema = z.enum(['en', 'fr', 'other', 'unknown']);
export type Language = z.output<typeof languageSchema>;

const httpUrl = z.url().refine((u) => /^https?:/i.test(u), 'must be an http(s) URL');

/** One posting as produced by an adapter, before dedupe and scoring. */
export const rawItemSchema = z.strictObject({
  /** Source-specific id (Ashby job id, Arbeitnow slug, ...). */
  external_id: z.string().min(1),
  org: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().trim().min(1).nullable(),
  remote_type: remoteTypeSchema,
  url: httpUrl,
  apply_url: httpUrl.nullable(),
  /** Plain text. The original HTML stays in `raw`. */
  description: z.string().nullable(),
  posted_at: z.iso.datetime().nullable(),
  /** The sentence that mentions a deadline, verbatim; parsed into a date later (M5). */
  deadline_text: z.string().nullable(),
  opportunity_type: opportunityTypeGuessSchema,
  language: languageSchema,
  /** The source's original JSON for this item. */
  raw: z.unknown(),
});
export type RawItem = z.output<typeof rawItemSchema>;

export interface ItemError {
  /** Position in the source payload. */
  index: number;
  externalId: string | null;
  reason: string;
  raw: unknown;
}

export interface AdapterResult {
  items: RawItem[];
  errors: ItemError[];
}

/** A configured source as the adapters see it (from seeds/sources.json or, later, the DB). */
export interface AdapterSource {
  name: string;
  kind: string;
  url: string | null;
  config: unknown;
}

export interface AdapterContext {
  http: HttpClient;
}

export interface Adapter<C = unknown> {
  kind: string;
  /** Validates `source.config` before anything is fetched. */
  configSchema: z.ZodType<C>;
  /** Fetches and parses. Throws only when the source as a whole fails (network, bad payload). */
  fetchItems(source: AdapterSource, ctx: AdapterContext): Promise<AdapterResult>;
}

function safeId<T>(idOf: (raw: T) => string | null, raw: T): string | null {
  try {
    return idOf(raw);
  } catch {
    return null;
  }
}

/** Builds a result from per-item parse attempts; anything thrown or invalid becomes an error. */
export function collect<T>(
  rawItems: readonly T[],
  toItem: (raw: T, index: number) => unknown,
  idOf: (raw: T) => string | null,
): AdapterResult {
  const items: RawItem[] = [];
  const errors: ItemError[] = [];
  rawItems.forEach((raw, index) => {
    const externalId = safeId(idOf, raw);
    try {
      const candidate = toItem(raw, index);
      if (candidate === null) return; // intentionally skipped (e.g. unlisted, filtered by config)
      const parsed = rawItemSchema.safeParse(candidate);
      if (parsed.success) items.push(parsed.data);
      else errors.push({ index, externalId, reason: z.prettifyError(parsed.error), raw });
    } catch (err) {
      errors.push({
        index,
        externalId,
        reason: err instanceof Error ? err.message : String(err),
        raw,
      });
    }
  });
  return { items, errors };
}
