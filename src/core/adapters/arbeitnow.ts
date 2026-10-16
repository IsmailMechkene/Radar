// Arbeitnow job board API (www.arbeitnow.com/api/job-board-api). Free, no key; asks for a link
// back, so the source URL points to arbeitnow.com. Mostly Germany; 300 jobs per page.
import { z } from 'zod';
import {
  findDeadlineSentence,
  guessLanguage,
  guessOpportunityType,
  htmlToText,
  normalizeRemoteType,
  toUtcIso,
} from './normalize';
import { collect, type Adapter, type AdapterResult, type AdapterSource } from './types';

export const ARBEITNOW_API = 'https://www.arbeitnow.com/api/job-board-api';

export const arbeitnowConfigSchema = z.strictObject({
  /** Server-side filter (documented `visa_sponsorship` parameter). Omit for all jobs. */
  visaSponsorship: z.boolean().optional(),
  /**
   * Keep only jobs whose `job_types` contain one of these (case-insensitive substring), e.g.
   * ["internship", "praktikum", "werkstudent"]. Empty or omitted keeps everything.
   */
  jobTypes: z.array(z.string().trim().min(1)).default([]),
  /** Pages to read per scan (300 jobs each). Kept small to stay polite. */
  maxPages: z.int().min(1).max(5).default(1),
});
export type ArbeitnowConfig = z.output<typeof arbeitnowConfigSchema>;

export function arbeitnowPageUrl(page: number, config: ArbeitnowConfig): string {
  const u = new URL(ARBEITNOW_API);
  u.searchParams.set('page', String(page));
  if (config.visaSponsorship !== undefined) {
    u.searchParams.set('visa_sponsorship', String(config.visaSponsorship));
  }
  return u.toString();
}

const pageSchema = z.object({
  data: z.array(z.unknown()),
  links: z.object({ next: z.string().nullish() }).loose().nullish(),
});

const jobSchema = z.object({
  slug: z.string().min(1),
  company_name: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  remote: z.boolean().nullish(),
  url: z.string(),
  tags: z.array(z.string()).nullish(),
  job_types: z.array(z.string()).nullish(),
  location: z.string().nullish(),
  created_at: z.number().nullish(),
});

function keepByJobTypes(jobTypes: readonly string[], wanted: readonly string[]): boolean {
  if (!wanted.length) return true;
  const have = jobTypes.map((t) => t.toLowerCase());
  return wanted.some((w) => have.some((t) => t.includes(w.toLowerCase())));
}

/** Pure parser for one page (used by tests with recorded fixtures). */
export function parseArbeitnow(payload: unknown, config: ArbeitnowConfig): AdapterResult {
  const { data } = pageSchema.parse(payload);
  return collect(
    data,
    (raw) => {
      const job = jobSchema.parse(raw);
      const jobTypes = job.job_types ?? [];
      if (!keepByJobTypes(jobTypes, config.jobTypes)) return null;
      const description = job.description ? htmlToText(job.description) : null;
      const loc = job.location?.trim() || null;
      return {
        external_id: job.slug,
        org: job.company_name,
        title: job.title.trim(),
        location: loc,
        remote_type: normalizeRemoteType({
          isRemote: job.remote,
          text: `${job.title} ${loc ?? ''}`,
        }),
        url: job.url,
        apply_url: job.url,
        description,
        posted_at: toUtcIso(job.created_at, 's'),
        deadline_text: findDeadlineSentence(description),
        opportunity_type: guessOpportunityType({ title: job.title, labels: jobTypes }),
        language: guessLanguage(`${job.title}\n${description ?? ''}`),
        raw,
      };
    },
    (raw) => {
      const slug = (raw as { slug?: unknown } | null)?.slug;
      return typeof slug === 'string' ? slug : null;
    },
  );
}

export const arbeitnowAdapter: Adapter<ArbeitnowConfig> = {
  kind: 'arbeitnow',
  configSchema: arbeitnowConfigSchema,
  async fetchItems(source: AdapterSource, { http }) {
    const config = arbeitnowConfigSchema.parse(source.config);
    const result: AdapterResult = { items: [], errors: [] };
    for (let page = 1; page <= config.maxPages; page++) {
      const payload = await http.getJson(arbeitnowPageUrl(page, config));
      const parsed = parseArbeitnow(payload, config);
      result.items.push(...parsed.items);
      result.errors.push(
        ...parsed.errors.map((e) => ({ ...e, index: e.index + (page - 1) * 1000 })),
      );
      if (!pageSchema.parse(payload).links?.next) break;
    }
    return result;
  },
};
