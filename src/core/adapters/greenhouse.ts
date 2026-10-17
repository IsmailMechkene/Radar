// Greenhouse public job board (docs: developers.greenhouse.io/job-board.html). "Job Board data is
// publicly available, so authentication is not required for any GET endpoints." One source per
// board; returns every job, typed per item (no filtering here).
import { z } from 'zod';
import {
  decodeEntities,
  findDeadlineSentence,
  guessLanguage,
  guessOpportunityType,
  htmlToText,
  normalizeRemoteType,
  toUtcIso,
} from './normalize';
import { collect, type Adapter, type AdapterResult, type AdapterSource } from './types';

export const greenhouseConfigSchema = z.strictObject({
  /** Board token from job-boards.greenhouse.io/<board> (e.g. "datadog"). */
  board: z.string().trim().min(1),
  /** Organization name to store. */
  org: z.string().trim().min(1),
});
export type GreenhouseConfig = z.output<typeof greenhouseConfigSchema>;

export function greenhouseBoardUrl(board: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
}

const payloadSchema = z.object({ jobs: z.array(z.unknown()) });

const named = z.object({ name: z.string().nullish() }).loose();

const jobSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  absolute_url: z.string(),
  location: named.nullish(),
  offices: z.array(z.object({ location: z.string().nullish() }).loose()).nullish(),
  departments: z.array(named).nullish(),
  metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() }).loose()).nullish(),
  /** HTML, entity-escaped ("&lt;p&gt;…"). */
  content: z.string().nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  /** Mostly null; a date when the company sets one. */
  application_deadline: z.string().nullish(),
  language: z.string().nullish(),
});
type Job = z.output<typeof jobSchema>;

/** The job's location; the offices only when it has none (they repeat it, noisier). */
function location(job: Job): string | null {
  const main = job.location?.name?.trim();
  if (main) return main;
  const offices = (job.offices ?? [])
    .map((o) => o.location?.trim())
    .filter((l): l is string => !!l);
  return offices.length ? [...new Set(offices)].join(' · ') : null;
}

/** Department names and the text values of custom fields ("Early Career Time Type: Internship"). */
function labels(job: Job): string[] {
  const out = (job.departments ?? []).map((d) => d.name ?? '');
  for (const m of job.metadata ?? []) {
    if (typeof m.value === 'string') out.push(m.value);
    else if (Array.isArray(m.value)) out.push(...m.value.filter((v) => typeof v === 'string'));
  }
  return out.filter(Boolean);
}

/** The deadline field as a sentence the deadline parser reads (its date part, as published). */
function deadlineField(value: string | null | undefined): string | null {
  const day = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return day ? `Application deadline: ${day}` : null;
}

/** Pure parser for a job-board payload (used by tests with recorded fixtures). */
export function parseGreenhouse(payload: unknown, config: GreenhouseConfig): AdapterResult {
  const { jobs } = payloadSchema.parse(payload);
  return collect(
    jobs,
    (raw) => {
      const job = jobSchema.parse(raw);
      const description = job.content ? htmlToText(decodeEntities(job.content)) : null;
      const loc = location(job);
      const lang = job.language?.toLowerCase();
      return {
        external_id: String(job.id),
        org: config.org,
        title: job.title.trim(),
        location: loc,
        remote_type: normalizeRemoteType({ text: `${job.title} ${loc ?? ''}` }),
        url: job.absolute_url,
        apply_url: null,
        description,
        posted_at: toUtcIso(job.first_published ?? job.updated_at),
        deadline_text: deadlineField(job.application_deadline) ?? findDeadlineSentence(description),
        opportunity_type: guessOpportunityType({ title: job.title, labels: labels(job) }),
        language:
          lang === 'en' || lang === 'fr'
            ? lang
            : guessLanguage(`${job.title}\n${description ?? ''}`),
        raw,
      };
    },
    (raw) => {
      const id = (raw as { id?: unknown } | null)?.id;
      return typeof id === 'number' ? String(id) : null;
    },
  );
}

export const greenhouseAdapter: Adapter<GreenhouseConfig> = {
  kind: 'greenhouse',
  configSchema: greenhouseConfigSchema,
  async fetchItems(source: AdapterSource, { http }) {
    const config = greenhouseConfigSchema.parse(source.config);
    return parseGreenhouse(await http.getJson(greenhouseBoardUrl(config.board)), config);
  },
};
