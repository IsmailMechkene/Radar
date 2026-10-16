import { describe, expect, it } from 'vitest';
import {
  createHttpClient,
  HttpError,
  parseRetryAfter,
  RobotsDisallowedError,
  USER_AGENT,
  type FetchFn,
} from '../src/core/http/client';
import { parseRobots } from '../src/core/http/robots';

describe('robots.txt (RFC 9309)', () => {
  const txt = `
# comment
User-agent: *
Disallow: /api/*
Disallow: /private
Allow: /private/public
Disallow: /*.pdf$
Crawl-delay: 3

User-agent: OtherBot
Disallow: /
`;

  it('applies the * group, longest match and Allow on ties', () => {
    const r = parseRobots(txt, 'Radar');
    expect(r.isAllowed('/jobs')).toBe(true);
    expect(r.isAllowed('/api/remote-jobs')).toBe(false);
    expect(r.isAllowed('/private/x')).toBe(false);
    expect(r.isAllowed('/private/public/x')).toBe(true);
    expect(r.isAllowed('/file.pdf')).toBe(false);
    expect(r.isAllowed('/file.pdf?x=1')).toBe(true); // $ anchors the end
    expect(r.crawlDelaySeconds).toBe(3);
  });

  it('uses the agent-specific group when one exists', () => {
    expect(parseRobots(txt, 'OtherBot/2.0').isAllowed('/jobs')).toBe(false);
    const own = parseRobots(
      'User-agent: radar\nDisallow: /x\n\nUser-agent: *\nDisallow: /',
      'Radar',
    );
    expect(own.isAllowed('/jobs')).toBe(true);
    expect(own.isAllowed('/x/1')).toBe(false);
  });

  it('empty Disallow and no rules allow everything', () => {
    expect(parseRobots('User-agent: *\nDisallow:', 'Radar').isAllowed('/a')).toBe(true);
    expect(parseRobots('', 'Radar').isAllowed('/a')).toBe(true);
    // Arbeitnow's real file
    const an = parseRobots('User-agent: *\nDisallow:\nDisallow: /*?__hstc', 'Radar');
    expect(an.isAllowed('/api/job-board-api?page=1')).toBe(true);
    expect(an.isAllowed('/x?__hstc=1')).toBe(false);
  });
});

describe('Retry-After', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:05 GMT', 1000)).toBe(4000);
    expect(parseRetryAfter('soon', 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});

/** Scripted fake network + fake clock. */
function harness(routes: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) }, at: t });
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return route(init);
  };
  return {
    calls,
    sleeps,
    client: (opts: Parameters<typeof createHttpClient>[0] = {}) =>
      createHttpClient({
        fetch: fetchFn,
        now: () => t,
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
        ...opts,
      }),
  };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

describe('HTTP client', () => {
  it('identifies itself and treats a missing robots.txt as allow-all', async () => {
    const h = harness({ 'https://a.test/jobs': () => json({ ok: 1 }) });
    expect(await h.client().getJson('https://a.test/jobs')).toEqual({ ok: 1 });
    expect(h.calls.map((c) => c.url)).toEqual(['https://a.test/robots.txt', 'https://a.test/jobs']);
    expect(h.calls[1]!.headers['User-Agent']).toBe(USER_AGENT);
  });

  it('limits each host to one request per second; other hosts are independent', async () => {
    const h = harness({
      'https://a.test/1': () => json(1),
      'https://a.test/2': () => json(2),
      'https://b.test/1': () => json(3),
    });
    const c = h.client();
    await c.get('https://a.test/1');
    await c.get('https://a.test/2');
    await c.get('https://b.test/1');
    const a = h.calls.filter((x) => x.url.startsWith('https://a.test'));
    expect(a.map((x) => x.at - a[0]!.at)).toEqual([0, 1000, 2000]); // robots, /1, /2
    const b = h.calls.filter((x) => x.url.startsWith('https://b.test'));
    expect(b[1]!.at - b[0]!.at).toBe(1000);
  });

  it('honors Crawl-delay when it is longer than the default', async () => {
    const h = harness({
      'https://c.test/robots.txt': () => new Response('User-agent: *\nCrawl-delay: 3'),
      'https://c.test/1': () => json(1),
      'https://c.test/2': () => json(2),
    });
    const c = h.client();
    await c.get('https://c.test/1');
    await c.get('https://c.test/2');
    const [, first, second] = h.calls;
    expect(second!.at - first!.at).toBe(3000);
  });

  it('refuses paths disallowed by robots.txt without requesting them', async () => {
    const h = harness({
      'https://r.test/robots.txt': () => new Response('User-agent: *\nDisallow: /api/*'),
      'https://r.test/api/jobs': () => json([]),
    });
    await expect(h.client().get('https://r.test/api/jobs')).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
    expect(h.calls.map((c) => c.url)).toEqual(['https://r.test/robots.txt']);
  });

  it('assumes disallow when robots.txt answers 5xx', async () => {
    const h = harness({
      'https://s.test/robots.txt': () => new Response('down', { status: 503 }),
      'https://s.test/jobs': () => json([]),
    });
    await expect(h.client({ maxRetries: 0 }).get('https://s.test/jobs')).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
  });

  it('backs off on 429 with Retry-After, then exponentially on 5xx', async () => {
    let n = 0;
    const h = harness({
      'https://x.test/jobs': () => {
        n += 1;
        if (n === 1)
          return new Response('slow down', { status: 429, headers: { 'retry-after': '5' } });
        if (n === 2) return new Response('oops', { status: 502 });
        return json({ ok: true });
      },
    });
    expect(await h.client().getJson('https://x.test/jobs')).toEqual({ ok: true });
    expect(h.sleeps).toContain(5000);
    expect(h.sleeps).toContain(2000); // second attempt: base 1000 * 2^1
    expect(n).toBe(3);
  });

  it('gives up after maxRetries with the last status', async () => {
    const h = harness({ 'https://y.test/jobs': () => new Response('no', { status: 500 }) });
    const err = await h
      .client({ maxRetries: 2 })
      .get('https://y.test/jobs')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect(h.calls.filter((c) => c.url === 'https://y.test/jobs')).toHaveLength(3);
  });

  it('does not retry other 4xx errors', async () => {
    const h = harness({ 'https://z.test/jobs': () => new Response('gone', { status: 404 }) });
    await expect(h.client().get('https://z.test/jobs')).rejects.toMatchObject({ status: 404 });
    expect(h.calls.filter((c) => c.url === 'https://z.test/jobs')).toHaveLength(1);
  });

  it('revalidates with ETag / Last-Modified and serves 304 from cache', async () => {
    let n = 0;
    const h = harness({
      'https://e.test/feed': (init) => {
        n += 1;
        const headers = init.headers as Record<string, string>;
        if (n === 2) {
          expect(headers['If-None-Match']).toBe('"v1"');
          expect(headers['If-Modified-Since']).toBe('Wed, 01 Oct 2026 00:00:00 GMT');
          return new Response(null, { status: 304 });
        }
        return new Response('<rss/>', {
          headers: { etag: '"v1"', 'last-modified': 'Wed, 01 Oct 2026 00:00:00 GMT' },
        });
      },
    });
    const c = h.client();
    expect((await c.get('https://e.test/feed')).fromCache).toBe(false);
    const second = await c.get('https://e.test/feed');
    expect(second).toMatchObject({ status: 304, fromCache: true, body: '<rss/>' });
  });

  it('times out a request that never answers', async () => {
    const h = harness({
      'https://t.test/slow': (init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await expect(
      h.client({ timeoutMs: 20, maxRetries: 0 }).get('https://t.test/slow'),
    ).rejects.toThrow(/timed out after 20 ms/);
  });

  it('rejects non-http protocols and non-JSON bodies', async () => {
    const h = harness({ 'https://j.test/x': () => new Response('<html>') });
    await expect(h.client().get('file:///etc/passwd')).rejects.toThrow(/Unsupported protocol/);
    await expect(h.client().getJson('https://j.test/x')).rejects.toThrow(/did not return JSON/);
  });
});
