import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arbeitnowAdapter,
  arbeitnowConfigSchema,
  arbeitnowPageUrl,
  parseArbeitnow,
} from '../src/core/adapters/arbeitnow';
import { ashbyAdapter, ashbyBoardUrl, parseAshby } from '../src/core/adapters/ashby';
import {
  greenhouseAdapter,
  greenhouseBoardUrl,
  parseGreenhouse,
} from '../src/core/adapters/greenhouse';
import { leverAdapter, leverPostingsUrl, parseLever } from '../src/core/adapters/lever';
import {
  parseRecruitee,
  recruiteeAdapter,
  recruiteeConfigSchema,
  recruiteeOffersUrl,
} from '../src/core/adapters/recruitee';
import { getAdapter } from '../src/core/adapters/registry';
import { rawItemSchema } from '../src/core/adapters/types';
import { createHttpClient, type FetchFn } from '../src/core/http/client';

const fixture = (rel: string) =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures', rel), 'utf8')) as Record<string, unknown>;

/** HTTP client over a fake network: robots.txt 404 (allow), fixtures for the given URLs. */
function fakeHttp(routes: Record<string, unknown>) {
  const requested: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    requested.push(url);
    if (url in routes) {
      return new Response(JSON.stringify(routes[url]), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  const http = createHttpClient({ fetch: fetchFn, now: () => 0, sleep: async () => {} });
  return { http, requested };
}

describe('Ashby adapter', () => {
  const mistral = fixture('ashby/mistral-ai-job-board.json');
  const cohere = fixture('ashby/cohere-job-board.json');

  it('parses every job, typed per item (no internship filtering)', () => {
    const { items, errors } = parseAshby(mistral, { board: 'mistral.ai', org: 'Mistral AI' });
    expect(errors).toEqual([]);
    expect(items).toHaveLength(3);
    for (const item of items) expect(rawItemSchema.safeParse(item).success).toBe(true);
    expect(items.map((i) => i.opportunity_type)).toEqual(['internship', 'internship', 'fulltime']);
    const first = items[0]!;
    expect(first.org).toBe('Mistral AI');
    expect(first.url).toMatch(/^https:\/\/jobs\.ashbyhq\.com\/mistral\.ai\//);
    expect(first.posted_at).toMatch(/Z$/);
    expect(first.description).not.toMatch(/<[a-z]/i); // plain text
    expect((first.raw as { descriptionHtml?: string }).descriptionHtml).toMatch(/</); // HTML kept in raw
  });

  it('"Senior Full-Stack Engineer, Internal Applications" is not an internship', () => {
    const { items } = parseAshby(cohere, { board: 'cohere', org: 'Cohere' });
    const internal = items.find(
      (i) => i.title === 'Senior Full-Stack Engineer, Internal Applications',
    );
    expect(internal?.opportunity_type).toBe('fulltime');
    expect(items.filter((i) => i.opportunity_type === 'internship').length).toBe(2);
    expect(internal?.remote_type).toBe('remote');
    expect(internal?.location).toBe('Toronto · Canada');
  });

  it('skips a malformed job and an unlisted job without failing the batch', () => {
    const jobs = (mistral['jobs'] as Record<string, unknown>[]).slice();
    const payload = {
      ...mistral,
      jobs: [
        { ...jobs[0], title: undefined }, // malformed: no title
        { ...jobs[1], jobUrl: 'javascript:alert(1)' }, // malformed: not an http URL
        { ...jobs[2], isListed: false }, // unlisted: intentionally skipped, not an error
        jobs[0],
        'not an object',
      ],
    };
    const { items, errors } = parseAshby(payload, { board: 'mistral.ai', org: 'Mistral AI' });
    expect(items).toHaveLength(1);
    expect(errors.map((e) => e.index)).toEqual([0, 1, 4]);
    expect(errors[0]!.externalId).toBe((jobs[0] as { id: string }).id);
    expect(errors[1]!.reason).toMatch(/http/);
  });

  it('a payload without a jobs array fails the whole source', () => {
    expect(() => parseAshby({ error: 'nope' }, { board: 'x', org: 'X' })).toThrow();
  });

  it('fetches the board URL through the polite client', async () => {
    const url = ashbyBoardUrl('mistral.ai');
    expect(url).toBe('https://api.ashbyhq.com/posting-api/job-board/mistral.ai');
    const { http, requested } = fakeHttp({ [url]: mistral });
    const result = await ashbyAdapter.fetchItems(
      {
        name: 'Mistral AI',
        kind: 'ashby',
        url: null,
        config: { board: 'mistral.ai', org: 'Mistral AI' },
      },
      { http },
    );
    expect(result.items).toHaveLength(3);
    expect(requested).toEqual(['https://api.ashbyhq.com/robots.txt', url]);
    await expect(
      ashbyAdapter.fetchItems(
        { name: 'x', kind: 'ashby', url: null, config: { board: '' } },
        { http },
      ),
    ).rejects.toThrow();
  });
});

describe('Arbeitnow adapter', () => {
  const page = fixture('arbeitnow/job-board-api-page1.json');
  const all = arbeitnowConfigSchema.parse({});

  it('parses every job with plain-text descriptions and typed items', () => {
    const { items, errors } = parseArbeitnow(page, all);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.opportunity_type)).toEqual([
      'internship',
      'internship',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    const intern = items[0]!;
    expect(intern.apply_url).toBe(intern.url);
    expect(intern.description).not.toMatch(/<[a-z]/i);
    expect(intern.posted_at).toMatch(/Z$/);
    expect(items.some((i) => i.remote_type === 'remote')).toBe(true);
  });

  it('keeps only configured job types', () => {
    const cfg = arbeitnowConfigSchema.parse({ jobTypes: ['internship', 'werkstudent'] });
    const { items } = parseArbeitnow(page, cfg);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.opportunity_type === 'internship')).toBe(true);
  });

  it('skips a malformed job without failing the batch', () => {
    const data = (page['data'] as Record<string, unknown>[]).slice();
    const { items, errors } = parseArbeitnow(
      { ...page, data: [{ ...data[0], company_name: '' }, { slug: 'x' }, data[1]] },
      all,
    );
    expect(items).toHaveLength(1);
    expect(errors.map((e) => e.index)).toEqual([0, 1]);
    expect(errors[1]!.externalId).toBe('x');
  });

  it('builds URLs with the visa_sponsorship filter and follows pages up to maxPages', async () => {
    const cfg = arbeitnowConfigSchema.parse({ visaSponsorship: true, maxPages: 2 });
    expect(arbeitnowPageUrl(1, cfg)).toBe(
      'https://www.arbeitnow.com/api/job-board-api?page=1&visa_sponsorship=true',
    );
    const p1 = { ...page, links: { next: 'https://www.arbeitnow.com/api/job-board-api?page=2' } };
    const p2 = { ...page, data: (page['data'] as unknown[]).slice(0, 1), links: { next: null } };
    const { http, requested } = fakeHttp({
      [arbeitnowPageUrl(1, cfg)]: p1,
      [arbeitnowPageUrl(2, cfg)]: p2,
    });
    const result = await arbeitnowAdapter.fetchItems(
      {
        name: 'Arbeitnow',
        kind: 'arbeitnow',
        url: 'https://www.arbeitnow.com',
        config: { visaSponsorship: true, maxPages: 2 },
      },
      { http },
    );
    expect(result.items).toHaveLength(6);
    expect(requested.filter((u) => u.includes('job-board-api'))).toHaveLength(2);
  });
});

describe('Greenhouse adapter', () => {
  const datadog = fixture('greenhouse/datadog-jobs-content.json');
  const config = { board: 'datadog', org: 'Datadog' };

  it('parses every job: plain text from escaped HTML, typed from custom fields', () => {
    const { items, errors } = parseGreenhouse(datadog, config);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(3);
    for (const item of items) expect(rawItemSchema.safeParse(item).success).toBe(true);
    expect(items.map((i) => [i.title, i.opportunity_type])).toEqual([
      ['Applied Science Intern', 'internship'],
      ['IT Support Technician Intern', 'internship'],
      ['Accounts Payable Analyst', 'fulltime'],
    ]);
    const first = items[0]!;
    expect(first).toMatchObject({
      external_id: '8181440',
      org: 'Datadog',
      location: 'Paris, France',
      url: 'https://careers.datadoghq.com/detail/8181440/?gh_jid=8181440',
      posted_at: '2026-09-08T14:09:29.000Z',
      language: 'en',
    });
    expect(first.description).toMatch(/^As an Applied Science Intern/);
    // No markup survives, escaped or not (the recorded fixture cuts each description at 1,800
    // characters, mid-tag, so only whole tags are checked).
    expect(first.description).not.toMatch(/<\/?(?:p|li|ul|strong|div)>|&lt;\/?(?:p|li|ul)&gt;/i);
  });

  it('turns a published application deadline into a sentence for the deadline parser', () => {
    const jobs = datadog['jobs'] as Record<string, unknown>[];
    const payload = { jobs: [{ ...jobs[0], application_deadline: '2026-11-30T23:59:00-05:00' }] };
    expect(parseGreenhouse(payload, config).items[0]!.deadline_text).toBe(
      'Application deadline: 2026-11-30',
    );
  });

  it('skips a malformed job without failing the batch; no jobs array fails the source', () => {
    const jobs = datadog['jobs'] as Record<string, unknown>[];
    const payload = {
      jobs: [{ ...jobs[0], absolute_url: 'javascript:alert(1)' }, { ...jobs[1], id: 'x' }, jobs[2]],
    };
    const { items, errors } = parseGreenhouse(payload, config);
    expect(items.map((i) => i.external_id)).toEqual(['8257324']);
    expect(errors.map((e) => e.index)).toEqual([0, 1]);
    expect(errors[0]!.externalId).toBe('8181440');
    expect(() => parseGreenhouse({ nope: 1 }, config)).toThrow();
  });

  it('fetches the board through the polite client', async () => {
    const url = greenhouseBoardUrl('datadog');
    expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=true');
    const { http, requested } = fakeHttp({ [url]: datadog });
    const result = await greenhouseAdapter.fetchItems(
      { name: 'Datadog', kind: 'greenhouse', url: null, config },
      { http },
    );
    expect(result.items).toHaveLength(3);
    expect(requested).toEqual(['https://boards-api.greenhouse.io/robots.txt', url]);
  });
});

describe('Lever adapter', () => {
  const palantir = fixture('lever/palantir-postings.json') as unknown as Record<string, unknown>[];
  const config = { site: 'palantir', org: 'Palantir' };

  it('parses every posting: workplace type, all locations, sections in the description', () => {
    const { items, errors } = parseLever(palantir, config);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(3);
    for (const item of items) expect(rawItemSchema.safeParse(item).success).toBe(true);
    const first = items[0]!;
    expect(first).toMatchObject({
      external_id: '6ed76ce8-4156-4b60-b120-403538bd66cd',
      org: 'Palantir',
      title: 'Administrative Business Partner',
      location: 'Singapore, Singapore',
      remote_type: 'hybrid',
      opportunity_type: 'fulltime',
      url: 'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd',
      apply_url: 'https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply',
      posted_at: '2026-08-11T17:38:11.368Z',
    });
    expect(first.description).toMatch(/A World-Changing Company/);
    expect(first.description).toMatch(/What We Require/); // list sections are kept
    expect(first.description).not.toMatch(/<[a-z]/i);
  });

  it('an "Intern" commitment makes an internship', () => {
    const intern = { ...palantir[0], categories: { commitment: 'Intern', location: 'Paris' } };
    expect(parseLever([intern], config).items[0]!.opportunity_type).toBe('internship');
  });

  it('skips a malformed posting without failing the batch; a non-array fails the source', () => {
    const { items, errors } = parseLever(
      [{ ...palantir[0], text: undefined }, palantir[1], 'nope'],
      config,
    );
    expect(items).toHaveLength(1);
    expect(errors.map((e) => e.index)).toEqual([0, 2]);
    expect(() => parseLever({ postings: [] }, config)).toThrow();
  });

  it('fetches the site through the polite client', async () => {
    const url = leverPostingsUrl('palantir');
    expect(url).toBe('https://api.lever.co/v0/postings/palantir?mode=json');
    const { http, requested } = fakeHttp({ [url]: palantir });
    const result = await leverAdapter.fetchItems(
      { name: 'Palantir', kind: 'lever', url: null, config },
      { http },
    );
    expect(result.items).toHaveLength(3);
    expect(requested).toEqual(['https://api.lever.co/robots.txt', url]);
  });
});

describe('Recruitee adapter', () => {
  // Three offers from bunq's careers site (2026-10-19), HTML trimmed; the last one's close_at was
  // set for this test, and a broken offer was added.
  const bunq = fixture('recruitee/bunq-offers.json');
  const config = { board: 'bunq', org: 'bunq' };

  it('parses every published offer and reports a broken one', () => {
    const { items, errors } = parseRecruitee(bunq, config);
    expect(errors.map((e) => e.index)).toEqual([3]);
    expect(items).toHaveLength(3);
    for (const item of items) expect(rawItemSchema.safeParse(item).success).toBe(true);
    expect(items[0]).toMatchObject({
      org: 'bunq',
      title: 'Audit Automation Intern',
      location: 'Amsterdam',
      remote_type: 'hybrid',
      opportunity_type: 'internship',
      posted_at: '2026-10-02T10:47:20.000Z',
    });
    expect(items[0]!.url).toMatch(/^https:\/\/careers\.bunq\.com\/o\//);
    expect(items[0]!.description).not.toMatch(/<[a-z]/i);
    // A permanent-contract code does not hide an internship title.
    expect(items[1]!.opportunity_type).toBe('internship');
    expect(items[2]).toMatchObject({
      opportunity_type: 'fulltime',
      deadline_text: 'Application deadline: 2026-11-30',
    });
  });

  it('skips offers that are not published', () => {
    const offers = (bunq as { offers: Record<string, unknown>[] }).offers.slice(0, 1);
    const draft = { offers: [{ ...offers[0], status: 'draft' }] };
    expect(parseRecruitee(draft, config).items).toEqual([]);
  });

  it('fetches the careers site through the polite client', async () => {
    const url = recruiteeOffersUrl('bunq');
    expect(url).toBe('https://bunq.recruitee.com/api/offers/');
    const { http, requested } = fakeHttp({ [url]: bunq });
    const result = await recruiteeAdapter.fetchItems(
      { name: 'bunq', kind: 'recruitee', url: null, config },
      { http },
    );
    expect(result.items).toHaveLength(3);
    expect(requested).toEqual(['https://bunq.recruitee.com/robots.txt', url]);
    expect(recruiteeConfigSchema.safeParse({ board: 'bunq.recruitee.com', org: 'x' }).success).toBe(
      false,
    );
  });
});

describe('registry', () => {
  it('maps kinds to adapters and rejects unknown kinds', () => {
    expect(getAdapter('ashby')).toBe(ashbyAdapter);
    expect(getAdapter('arbeitnow')).toBe(arbeitnowAdapter);
    expect(getAdapter('greenhouse')).toBe(greenhouseAdapter);
    expect(getAdapter('lever')).toBe(leverAdapter);
    expect(() => getAdapter('remotive')).toThrow(/No adapter for kind "remotive"/);
  });
});
