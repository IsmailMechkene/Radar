// Ashby public job board (docs: developers.ashbyhq.com/docs/public-job-posting-api).
// One source per organization; returns every listed job, typed per item (no filtering here).
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

export const ashbyConfigSchema = z.strictObject({
  /** Job board name from jobs.ashbyhq.com/<board>, case-sensitive (e.g. "DeepL", "mistral.ai"). */
  board: z.string().trim().min(1),
  /** Organization name to store (the API does not return it). */
  org: z.string().trim().min(1),
});
export type AshbyConfig = z.output<typeof ashbyConfigSchema>;

export function ashbyBoardUrl(board: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`;
}

const payloadSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() }).loose()).nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  jobUrl: z.string(),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
});

function location(job: z.output<typeof jobSchema>): string | null {
  const all = [job.location, ...(job.secondaryLocations ?? []).map((s) => s.location)]
    .map((l) => l?.trim())
    .filter((l): l is string => !!l);
  return all.length ? [...new Set(all)].join(' · ') : null;
}

/** Pure parser for a job-board payload (used by tests with recorded fixtures). */
export function parseAshby(payload: unknown, config: AshbyConfig): AdapterResult {
  const { jobs } = payloadSchema.parse(payload);
  return collect(
    jobs,
    (raw) => {
      const job = jobSchema.parse(raw);
      if (job.isListed === false) return null; // unlisted: "only available via direct link"
      const description = job.descriptionPlain?.trim()
        ? job.descriptionPlain.trim()
        : job.descriptionHtml
          ? htmlToText(job.descriptionHtml)
          : null;
      const loc = location(job);
      return {
        external_id: job.id,
        org: config.org,
        title: job.title.trim(),
        location: loc,
        remote_type: normalizeRemoteType({
          workplaceType: job.workplaceType,
          isRemote: job.isRemote,
          text: `${job.title} ${loc ?? ''}`,
        }),
        url: job.jobUrl,
        apply_url: job.applyUrl ?? null,
        description,
        posted_at: toUtcIso(job.publishedAt),
        deadline_text: findDeadlineSentence(description),
        opportunity_type: guessOpportunityType({
          employmentType: job.employmentType,
          title: job.title,
        }),
        language: guessLanguage(`${job.title}\n${description ?? ''}`),
        raw,
      };
    },
    (raw) => {
      const id = (raw as { id?: unknown } | null)?.id;
      return typeof id === 'string' ? id : null;
    },
  );
}

export const ashbyAdapter: Adapter<AshbyConfig> = {
  kind: 'ashby',
  configSchema: ashbyConfigSchema,
  async fetchItems(source: AdapterSource, { http }) {
    const config = ashbyConfigSchema.parse(source.config);
    return parseAshby(await http.getJson(ashbyBoardUrl(config.board)), config);
  },
};
