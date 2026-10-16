// robots.txt parsing and matching (RFC 9309), plus the non-standard Crawl-delay many sites use.

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelaySeconds: number | null;
}

export interface Robots {
  /** True when `pathWithQuery` may be fetched by the agent. */
  isAllowed(pathWithQuery: string): boolean;
  /** Seconds between requests requested by the matching group, if any. */
  crawlDelaySeconds: number | null;
}

/** Parses robots.txt into groups. Unknown lines are ignored, as the RFC requires. */
function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Effective length of a pattern for "most specific match wins" (wildcards don't count). */
function specificity(pattern: string): number {
  return pattern.replace(/[*$]/g, '').length;
}

/**
 * Builds a matcher for one user agent. The agent's own group applies if present (matched on the
 * product token, case-insensitive), otherwise the `*` group, otherwise everything is allowed.
 */
export function parseRobots(text: string, productToken: string): Robots {
  const groups = parseGroups(text);
  const token = productToken.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen
    .flatMap((g) => g.rules)
    .map((r) => ({ ...r, re: patternToRegExp(r.pattern) }));
  const crawlDelaySeconds =
    chosen.map((g) => g.crawlDelaySeconds).find((d): d is number => d !== null) ?? null;

  return {
    crawlDelaySeconds,
    isAllowed(pathWithQuery: string): boolean {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (!r.re.test(pathWithQuery)) continue;
        const len = specificity(r.pattern);
        // Longest match wins; on a tie, Allow wins (RFC 9309 2.2.2).
        if (!best || len > best.len || (len === best.len && r.allow))
          best = { allow: r.allow, len };
      }
      return best ? best.allow : true;
    },
  };
}

/** Everything allowed (robots.txt missing: RFC 9309 treats 4xx as "no restrictions"). */
export const ALLOW_ALL: Robots = { isAllowed: () => true, crawlDelaySeconds: null };

/** Everything refused (robots.txt unreachable: RFC 9309 treats 5xx/network errors as "disallow"). */
export const DISALLOW_ALL: Robots = { isAllowed: () => false, crawlDelaySeconds: null };
