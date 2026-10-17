// Security review regressions: redirects and response size in the fetch layer, and time budgets
// for every text processor that sees scraped content (no quadratic or catastrophic regexes).
import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/core/adapters/normalize';
import { parseDates, readDate } from '../src/core/deadlines/parse';
import {
  createHttpClient,
  MAX_BODY_BYTES,
  RobotsDisallowedError,
  type FetchFn,
} from '../src/core/http/client';
import { parseCsv } from '../src/core/pipeline/csv';
import { normalizePageText } from '../src/core/watch/pages';

function client(
  routes: Record<string, () => Response>,
  extra: Parameters<typeof createHttpClient>[0] = {},
) {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push(url);
    expect(init.redirect).toBe('manual');
    return (routes[url] ?? (() => new Response('', { status: 404 })))();
  };
  return {
    calls,
    http: createHttpClient({ fetch: fetchFn, now: () => 0, sleep: async () => {}, ...extra }),
  };
}
const redirect =
  (to: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location: to } });

describe('fetch layer: redirects', () => {
  it('follows a redirect to another host and checks that host’s robots.txt', async () => {
    const { calls, http } = client({
      'https://a.test/jobs': redirect('https://b.test/careers'),
      'https://b.test/careers': () => new Response('ok'),
    });
    const r = await http.get('https://a.test/jobs');
    expect(r.body).toBe('ok');
    expect(calls).toEqual([
      'https://a.test/robots.txt',
      'https://a.test/jobs',
      'https://b.test/robots.txt',
      'https://b.test/careers',
    ]);
  });

  it('refuses a redirect into a path the other host disallows', async () => {
    const { http } = client({
      'https://a.test/jobs': redirect('https://b.test/private/x'),
      'https://b.test/robots.txt': () => new Response('User-agent: *\nDisallow: /private'),
    });
    await expect(http.get('https://a.test/jobs')).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it('stops after 5 redirects and never leaves http(s)', async () => {
    const loop: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) loop[`https://a.test/${i}`] = redirect(`https://a.test/${i + 1}`);
    await expect(client(loop).http.get('https://a.test/0')).rejects.toThrow(
      /more than 5 redirects/,
    );
    const { http } = client({ 'https://a.test/x': redirect('file:///etc/passwd') });
    await expect(http.get('https://a.test/x')).rejects.toThrow(/Unsupported protocol/);
  });

  it('follows redirects for robots.txt itself (RFC 9309)', async () => {
    const { http } = client({
      'https://a.test/robots.txt': redirect('https://www.a.test/robots.txt', 301),
      'https://www.a.test/robots.txt': () => new Response('User-agent: *\nDisallow: /'),
      'https://a.test/page': () => new Response('should not be fetched'),
    });
    await expect(http.get('https://a.test/page')).rejects.toBeInstanceOf(RobotsDisallowedError);
  });
});

describe('fetch layer: response size', () => {
  it('refuses a body larger than the limit, declared or streamed', async () => {
    const big = 'x'.repeat(2048);
    const declared = client(
      { 'https://a.test/x': () => new Response(big, { headers: { 'content-length': '2048' } }) },
      { maxBodyBytes: 1024 },
    );
    await expect(declared.http.get('https://a.test/x')).rejects.toThrow(/larger than 1024 bytes/);
    const streamed = client(
      {
        'https://a.test/x': () =>
          new Response(
            new ReadableStream({
              start(c) {
                for (let i = 0; i < 4; i++) c.enqueue(new TextEncoder().encode('x'.repeat(512)));
                c.close();
              },
            }),
          ),
      },
      { maxBodyBytes: 1024 },
    );
    await expect(streamed.http.get('https://a.test/x')).rejects.toThrow(/larger than 1024 bytes/);
    expect(MAX_BODY_BYTES).toBe(10 * 1024 * 1024);
  });

  it('decodes multi-byte text split across chunks', async () => {
    const bytes = new TextEncoder().encode('Date limite : 31 décembre');
    const { http } = client({
      'https://a.test/x': () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const b of bytes) c.enqueue(new Uint8Array([b]));
              c.close();
            },
          }),
        ),
    });
    expect((await http.get('https://a.test/x')).body).toBe('Date limite : 31 décembre');
  });
});

describe('text processors: no blow-ups on hostile input', () => {
  const N = 200_000;
  const rep = (s: string) => s.repeat(Math.ceil(N / s.length));
  const timed = (fn: () => unknown) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  const ctx = { reference: new Date('2026-10-16T00:00:00Z'), timeZone: 'Africa/Tunis' };

  // Each of these took 0.6-4 s on 200 KB before the review (quadratic); all are linear now.
  it.each([
    ['htmlToText, unclosed tags', () => htmlToText(rep('<div '))],
    ['htmlToText, many <script>', () => htmlToText(rep('<script>'))],
    ['page text, digit runs', () => normalizePageText('Deadline: ' + rep('1 '))],
    ['page text, unclosed <nav>', () => normalizePageText(rep('<nav>'))],
    ['page text, unclosed comments', () => normalizePageText(rep('<!--'))],
    ['dates, repeated cues', () => parseDates(rep('apply by '), ctx)],
    ['dates, month runs', () => parseDates(rep('March 1 '), ctx)],
    ['date cell, month runs', () => readDate(rep('March 1 '), ctx)],
    ['CSV, quotes in one long field', () => parseCsv(rep('<div class="cookie">'))],
  ])('%s stays under 1 s for 200 KB', (_name, fn) => {
    expect(timed(fn)).toBeLessThan(1000);
  });

  it('still reads real pages: links are not bullets, an unclosed <nav> keeps the content', () => {
    expect(htmlToText('<link rel="x"><li>Item</li>')).toBe('• Item');
    expect(normalizePageText('<nav>Menu<main><p>Apply by 1 March 2027</p></main>')).toContain(
      'Apply by 1 March 2027',
    );
    expect(normalizePageText('<p>Keep</p><script>var x = "<p>drop</p>"')).toBe('Keep');
  });
});
