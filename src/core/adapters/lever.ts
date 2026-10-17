// Lever public postings API (README: github.com/lever/postings-api): "all job postings in the
// `published` state are publicly viewable." robots.txt asks for Crawl-delay 1, which the shared
// client's 1 request/s per host already honors. One source per site; every posting, typed per item.
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

export const leverConfigSchema = z.strictObject({
  /** Site name from jobs.lever.co/<site> (e.g. "palantir"). */
  site: z.string().trim().min(1),
  /** Organization name to store (postings do not carry it). */
  org: z.string().trim().min(1),
});
export type LeverConfig = z.output<typeof leverConfigSchema>;

export function leverPostingsUrl(site: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
}

const postingSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  hostedUrl: z.string(),
  applyUrl: z.string().nullish(),
  createdAt: z.number().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      commitment: z.string().nullish(),
      location: z.string().nullish(),
      team: z.string().nullish(),
      department: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .loose()
    .nullish(),
  descriptionPlain: z.string().nullish(),
  description: z.string().nullish(),
  lists: z
    .array(z.object({ text: z.string().nullish(), content: z.string().nullish() }).loose())
    .nullish(),
  additionalPlain: z.string().nullish(),
});
type Posting = z.output<typeof postingSchema>;

function location(p: Posting): string | null {
  const c = p.categories;
  const all = [...(c?.allLocations ?? []), c?.location]
    .map((l) => l?.trim())
    .filter((l): l is string => !!l);
  return all.length ? [...new Set(all)].join(' · ') : null;
}

/** Intro, then each list section ("What we require", …) as a heading and lines, then the rest. */
function description(p: Posting): string | null {
  const intro = p.descriptionPlain?.trim() || (p.description ? htmlToText(p.description) : '');
  const sections = (p.lists ?? []).map((l) =>
    [l.text?.trim(), l.content ? htmlToText(l.content) : ''].filter(Boolean).join('\n'),
  );
  const text = [intro, ...sections, p.additionalPlain?.trim() ?? '']
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return text || null;
}

/** Pure parser for a postings payload (used by tests with recorded fixtures). */
export function parseLever(payload: unknown, config: LeverConfig): AdapterResult {
  const postings = z.array(z.unknown()).parse(payload);
  return collect(
    postings,
    (raw) => {
      const p = postingSchema.parse(raw);
      const text = description(p);
      const loc = location(p);
      const c = p.categories;
      return {
        external_id: p.id,
        org: config.org,
        title: p.text.trim(),
        location: loc,
        remote_type: normalizeRemoteType({
          workplaceType: p.workplaceType,
          text: `${p.text} ${loc ?? ''}`,
        }),
        url: p.hostedUrl,
        apply_url: p.applyUrl ?? null,
        description: text,
        posted_at: toUtcIso(p.createdAt),
        deadline_text: findDeadlineSentence(text),
        opportunity_type: guessOpportunityType({
          employmentType: c?.commitment,
          title: p.text,
          labels: [c?.commitment, c?.team, c?.department].filter((l): l is string => !!l),
        }),
        language: guessLanguage(`${p.text}\n${text ?? ''}`),
        raw,
      };
    },
    (raw) => {
      const id = (raw as { id?: unknown } | null)?.id;
      return typeof id === 'string' ? id : null;
    },
  );
}

export const leverAdapter: Adapter<LeverConfig> = {
  kind: 'lever',
  configSchema: leverConfigSchema,
  async fetchItems(source: AdapterSource, { http }) {
    const config = leverConfigSchema.parse(source.config);
    return parseLever(await http.getJson(leverPostingsUrl(config.site)), config);
  },
};
