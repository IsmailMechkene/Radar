// Polite HTTP client for every source: identifies the app, honors robots.txt and Crawl-delay,
// limits each host to one request per second, backs off on 429/5xx, revalidates with
// ETag/Last-Modified, and times out. Clock, sleep and fetch are injected so tests need no network.
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type Robots } from './robots';

export const USER_AGENT =
  'Radar/0.1 (+https://github.com/IsmailMechkene/Radar; personal internship search, local-first)';
/** Product token used to pick our group in robots.txt. */
export const ROBOTS_TOKEN = 'Radar';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface CacheEntry {
  etag: string | null;
  lastModified: string | null;
  body: string;
  contentType: string | null;
}

/** Validator cache; in memory by default, can be backed by the database later. */
export interface HttpCache {
  get(url: string): CacheEntry | undefined;
  set(url: string, entry: CacheEntry): void;
}

export class MemoryCache implements HttpCache {
  private readonly map = new Map<string, CacheEntry>();
  get(url: string) {
    return this.map.get(url);
  }
  set(url: string, entry: CacheEntry) {
    this.map.set(url, entry);
  }
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HttpError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface HttpResponse {
  url: string;
  status: number;
  body: string;
  contentType: string | null;
  /** True when the server answered 304 and the cached body was returned. */
  fromCache: boolean;
}

export interface HttpClientOptions {
  fetch?: FetchFn;
  /** Milliseconds since epoch. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cache?: HttpCache;
  userAgent?: string;
  /** Minimum gap between two requests to the same host. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Retries after the first attempt, for 429, 5xx and network errors. */
  maxRetries?: number;
  /** First backoff delay; doubles each retry unless the server sends Retry-After. */
  backoffBaseMs?: number;
  /** Upper bound for any single wait (Retry-After included). */
  maxWaitMs?: number;
}

export interface GetOptions {
  accept?: string;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

/** Retry-After as seconds or an HTTP date; null if absent or unparsable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export function createHttpClient(opts: HttpClientOptions = {}) {
  const doFetch: FetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cache = opts.cache ?? new MemoryCache();
  const userAgent = opts.userAgent ?? USER_AGENT;
  const minIntervalMs = opts.minIntervalMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 1000;
  const maxWaitMs = opts.maxWaitMs ?? 60_000;

  const nextSlot = new Map<string, number>();
  const robotsByOrigin = new Map<string, Promise<Robots>>();

  /** Waits for the host's next free slot, then reserves the following one. */
  async function throttle(host: string, intervalMs: number): Promise<void> {
    const t = now();
    const at = Math.max(t, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + intervalMs);
    if (at > t) await sleep(at - t);
  }

  async function attempt(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, { headers, redirect: 'follow', signal: controller.signal });
    } catch (err) {
      const reason = controller.signal.aborted ? `timed out after ${timeoutMs} ms` : String(err);
      throw new HttpError(url, null, `GET ${url} failed: ${reason}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  /** One request with throttling and retries; no robots check. */
  async function request(
    url: string,
    host: string,
    intervalMs: number,
    headers: Record<string, string>,
  ) {
    let lastError: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      await throttle(host, intervalMs);
      let res: Response;
      try {
        res = await attempt(url, headers);
      } catch (err) {
        lastError = err;
        if (i < maxRetries) await sleep(Math.min(maxWaitMs, backoffBaseMs * 2 ** i));
        continue;
      }
      if (!RETRYABLE(res.status) || i === maxRetries) return res;
      const wait = parseRetryAfter(res.headers.get('retry-after'), now()) ?? backoffBaseMs * 2 ** i;
      lastError = new HttpError(url, res.status, `GET ${url} answered ${res.status}`);
      await sleep(Math.min(maxWaitMs, wait));
    }
    throw lastError instanceof Error
      ? lastError
      : new HttpError(url, null, `GET ${url} failed after ${maxRetries + 1} attempts`);
  }

  function robotsFor(origin: string, host: string): Promise<Robots> {
    let p = robotsByOrigin.get(origin);
    if (!p) {
      p = (async () => {
        try {
          const res = await request(`${origin}/robots.txt`, host, minIntervalMs, {
            'User-Agent': userAgent,
            Accept: 'text/plain',
          });
          if (res.status >= 200 && res.status < 300)
            return parseRobots(await res.text(), ROBOTS_TOKEN);
          // RFC 9309 2.3.1.3: 4xx means no restrictions; 5xx means assume complete disallow.
          return res.status >= 400 && res.status < 500 ? ALLOW_ALL : DISALLOW_ALL;
        } catch {
          return DISALLOW_ALL; // unreachable robots.txt: assume disallow (RFC 9309 2.3.1.4)
        }
      })();
      robotsByOrigin.set(origin, p);
    }
    return p;
  }

  return {
    userAgent,

    /**
     * GET with every politeness rule applied. Throws RobotsDisallowedError when robots.txt
     * forbids the path, HttpError for network failures, timeouts and non-2xx answers.
     */
    async get(url: string, options: GetOptions = {}): Promise<HttpResponse> {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new HttpError(url, null, `Unsupported protocol in ${url}`);
      }
      const robots = await robotsFor(u.origin, u.host);
      if (!robots.isAllowed(`${u.pathname}${u.search}`)) throw new RobotsDisallowedError(url);
      const intervalMs = Math.max(minIntervalMs, (robots.crawlDelaySeconds ?? 0) * 1000);

      const headers: Record<string, string> = { 'User-Agent': userAgent };
      if (options.accept) headers['Accept'] = options.accept;
      const cached = cache.get(url);
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

      const res = await request(url, u.host, intervalMs, headers);
      if (res.status === 304 && cached) {
        return {
          url,
          status: 304,
          body: cached.body,
          contentType: cached.contentType,
          fromCache: true,
        };
      }
      if (res.status < 200 || res.status >= 300) {
        throw new HttpError(url, res.status, `GET ${url} answered ${res.status}`);
      }
      const body = await res.text();
      const contentType = res.headers.get('content-type');
      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');
      if (etag || lastModified) cache.set(url, { etag, lastModified, body, contentType });
      return { url, status: res.status, body, contentType, fromCache: false };
    },

    /** GET and parse JSON; a body that is not JSON is an HttpError. */
    async getJson(url: string): Promise<unknown> {
      const res = await this.get(url, { accept: 'application/json' });
      try {
        return JSON.parse(res.body) as unknown;
      } catch (err) {
        throw new HttpError(url, res.status, `GET ${url} did not return JSON`, { cause: err });
      }
    },
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
