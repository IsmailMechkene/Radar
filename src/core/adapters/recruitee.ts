// Recruitee Careers Site API (docs.recruitee.com/reference/offers): GET
// https://<company>.recruitee.com/api/offers/ lists a company's published offers, no token (the
// spec declares no security for it). robots.txt on the careers subdomains allows /api/. One source
// per company; every offer, typed per item (no filtering here).
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

export const recruiteeConfigSchema = z.strictObject({
  /** Careers subdomain from <board>.recruitee.com (e.g. "bunq"). */
  board: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/i, 'the part before .recruitee.com'),
  /** Organization name to store. */
  org: z.string().trim().min(1),
});
export type RecruiteeConfig = z.output<typeof recruiteeConfigSchema>;

export function recruiteeOffersUrl(board: string): string {
  return `https://${board.toLowerCase()}.recruitee.com/api/offers/`;
}

const payloadSchema = z.object({ offers: z.array(z.unknown()) });

const offerSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  status: z.string().nullish(),
  careers_url: z.string(),
  careers_apply_url: z.string().nullish(),
  location: z.string().nullish(),
  locations: z.array(z.object({ name: z.string().nullish() }).loose()).nullish(),
  remote: z.boolean().nullish(),
  hybrid: z.boolean().nullish(),
  on_site: z.boolean().nullish(),
  /** HTML. */
  description: z.string().nullish(),
  requirements: z.string().nullish(),
  /** "internship", "fulltime_permanent", "fulltime_fixed_term", "parttime_…", … */
  employment_type_code: z.string().nullish(),
  department: z.string().nullish(),
  /** "2026-10-15 09:31:36 UTC". */
  published_at: z.string().nullish(),
  created_at: z.string().nullish(),
  /** When the offer closes, if the company set it. */
  close_at: z.string().nullish(),
});
type Offer = z.output<typeof offerSchema>;

/** Recruitee writes "2026-10-15 09:31:36 UTC"; make it ISO before parsing. */
function recruiteeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return toUtcIso(value.trim().replace(/ UTC$/, 'Z').replace(' ', 'T'));
}

function location(o: Offer): string | null {
  const names = (o.locations ?? []).map((l) => l.name?.trim()).filter((n): n is string => !!n);
  if (names.length) return [...new Set(names)].join(' · ');
  return o.location?.trim() || null;
}

function workplaceType(o: Offer): string | null {
  if (o.remote) return 'remote';
  if (o.hybrid) return 'hybrid';
  if (o.on_site) return 'onsite';
  return null;
}

/** The closing date as a sentence the deadline parser reads. */
function closeSentence(value: string | null | undefined): string | null {
  const day = recruiteeDate(value)?.slice(0, 10);
  return day ? `Application deadline: ${day}` : null;
}

/** Pure parser for an offers payload (used by tests with recorded fixtures). */
export function parseRecruitee(payload: unknown, config: RecruiteeConfig): AdapterResult {
  const { offers } = payloadSchema.parse(payload);
  return collect(
    offers,
    (raw) => {
      const o = offerSchema.parse(raw);
      if (o.status && o.status !== 'published') return null;
      const html = [o.description, o.requirements].filter(Boolean).join('\n');
      const description = html ? htmlToText(html) : null;
      const loc = location(o);
      return {
        external_id: String(o.id),
        org: config.org,
        title: o.title.trim(),
        location: loc,
        remote_type: normalizeRemoteType({
          workplaceType: workplaceType(o),
          text: `${o.title} ${loc ?? ''}`,
        }),
        url: o.careers_url,
        apply_url: o.careers_apply_url ?? null,
        description,
        posted_at: recruiteeDate(o.published_at ?? o.created_at),
        deadline_text: closeSentence(o.close_at) ?? findDeadlineSentence(description),
        opportunity_type: guessOpportunityType({
          // "fulltime_permanent" / "fulltime_fixed_term": a title saying Intern still wins.
          employmentType: o.employment_type_code?.startsWith('fulltime')
            ? 'fulltime'
            : o.employment_type_code,
          title: o.title,
          labels: o.department ? [o.department] : [],
        }),
        language: guessLanguage(`${o.title}\n${description ?? ''}`),
        raw,
      };
    },
    (raw) => {
      const id = (raw as { id?: unknown } | null)?.id;
      return typeof id === 'number' ? String(id) : null;
    },
  );
}

export const recruiteeAdapter: Adapter<RecruiteeConfig> = {
  kind: 'recruitee',
  configSchema: recruiteeConfigSchema,
  async fetchItems(source: AdapterSource, { http }) {
    const config = recruiteeConfigSchema.parse(source.config);
    return parseRecruitee(await http.getJson(recruiteeOffersUrl(config.board)), config);
  },
};
