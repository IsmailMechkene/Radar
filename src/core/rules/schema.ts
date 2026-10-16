// seeds/rules.json (SPEC section 6): keyword lists, weights and thresholds, all user-editable later.
import { z } from 'zod';
import { opportunityTypeSchema } from '../db/schemas';

const terms = z.array(z.string().trim().min(1)).min(1);
const points = z.number().finite();

export const rulesSchema = z.strictObject({
  version: z.literal(1),
  thresholds: z
    .strictObject({ apply: z.number().min(0).max(100), maybe: z.number().min(0).max(100) })
    .refine((t) => t.maybe <= t.apply, 'maybe threshold must not exceed apply'),
  role: z.strictObject({
    max: points.min(0),
    rolesOfInterestPoints: points.min(0),
    groups: z
      .array(z.strictObject({ label: z.string().min(1), points: points.min(0), terms }))
      .min(1),
  }),
  stack: z.strictObject({ max: points.min(0), pointsEach: points.min(0), terms }),
  student: z.strictObject({
    max: points.min(0),
    typePoints: z.record(opportunityTypeSchema, points.min(0)),
    termPoints: points.min(0),
    terms,
  }),
  location: z.strictObject({
    max: points.min(0),
    regionPoints: points.min(0),
    workplacePoints: points.min(0),
    languagePoints: z.strictObject({ en: points.min(0), fr: points.min(0) }),
  }),
  /** Region name (as used in Settings > Target regions) -> location keywords. */
  regions: z.record(z.string().min(1), terms),
  visa: z.strictObject({ points: points.min(0), terms }),
  watchlist: z.strictObject({ points: points.min(0), orgs: terms }),
  fresh: z.strictObject({ points: points.min(0), days: z.int().min(0) }),
  deadline: z.strictObject({ points: points.min(0), minDaysAway: z.int().min(0) }),
  penalties: z.strictObject({
    max: points.min(0),
    seniorTitle: z.strictObject({ points: points.max(0), terms }),
    experience: z.strictObject({ points: points.max(0), terms }),
    language: z.strictObject({
      points: points.max(0),
      /** Languages the user can work in; a required language outside this list is penalized. */
      spoken: terms,
      /** Posting written in another language (not English or French). */
      otherLanguagePostingPoints: points.max(0),
    }),
    notRemote: z.strictObject({ points: points.max(0) }),
  }),
  hardFilters: z.strictObject({
    titleExcludes: terms,
    /** Title words that do not exclude internship/PFE/program titles ("Product Manager Intern"). */
    allowedInStudentTitles: z.array(z.string().trim().min(1)),
    studentTypes: z.array(opportunityTypeSchema).min(1),
  }),
  eligibility: z.strictObject({
    workAuthLock: terms,
    workAuthAmbiguous: terms,
    agreementTerms: terms,
  }),
});

export type Rules = z.output<typeof rulesSchema>;

export function parseRules(raw: unknown): Rules {
  return rulesSchema.parse(raw);
}
