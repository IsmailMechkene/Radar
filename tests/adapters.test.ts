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

describe('registry', () => {
  it('maps kinds to adapters and rejects unknown kinds', () => {
    expect(getAdapter('ashby')).toBe(ashbyAdapter);
    expect(getAdapter('arbeitnow')).toBe(arbeitnowAdapter);
    expect(() => getAdapter('remotive')).toThrow(/No adapter for kind "remotive"/);
  });
});
