// Seed sources (seeds/sources.json): validated here, loaded into the database in a later step.
import { z } from 'zod';
import { getAdapter } from '../adapters/registry';
import { accessMethodSchema } from '../db/schemas';

/** Source kind for a web page watched for changes (programs, pages added by the user). */
export const PAGE_KIND = 'page';

export const seedSourceSchema = z.strictObject({
  /** Unique, human-readable; used by `scan:dry --source <name>`. */
  name: z.string().trim().min(1),
  /** Adapter kind (see adapters/registry), or a kind whose adapter does not exist yet. */
  kind: z.string().trim().min(1),
  access_method: accessMethodSchema,
  /** Public page to link back to (careers page, board, or the aggregator's site). */
  url: z.url().nullable(),
  tos_note: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  /** `pending` = known source waiting for an adapter; never scanned. */
  status: z.enum(['active', 'pending']),
  note: z.string().optional(),
});
export type SeedSource = z.output<typeof seedSourceSchema>;

export const seedSourcesFileSchema = z
  .strictObject({ version: z.literal(1), sources: z.array(seedSourceSchema) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.sources.forEach((s, i) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate source name "${s.name}"`,
          path: ['sources', i, 'name'],
        });
      }
      seen.add(key);
      if (s.status !== 'active') return;
      // Watched pages have no adapter: they are fetched for change detection, not scanned.
      if (s.kind === PAGE_KIND) {
        if (!s.url) {
          ctx.addIssue({
            code: 'custom',
            message: `"${s.name}": a page needs a url`,
            path: ['sources', i, 'url'],
          });
        }
        return;
      }
      // Active sources must have a registered adapter and a valid config for it.
      let configSchema: z.ZodType;
      try {
        configSchema = getAdapter(s.kind).configSchema;
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: String(err), path: ['sources', i, 'kind'] });
        return;
      }
      const parsed = configSchema.safeParse(s.config);
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid config for "${s.name}": ${z.prettifyError(parsed.error)}`,
          path: ['sources', i, 'config'],
        });
      }
    });
  });

export function parseSeedSources(raw: unknown): SeedSource[] {
  return seedSourcesFileSchema.parse(raw).sources;
}

export function findSeedSource(
  sources: readonly SeedSource[],
  name: string,
): SeedSource | undefined {
  const key = name.trim().toLowerCase();
  return sources.find((s) => s.name.toLowerCase() === key);
}
