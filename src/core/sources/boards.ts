// Job-board platforms a user can add on the Sources page, and their board links. Pure, shared by
// core (adding a source) and the renderer (recognizing a pasted link).

export const BOARD_PLATFORMS = ['ashby', 'greenhouse', 'lever'] as const;
export type BoardPlatform = (typeof BOARD_PLATFORMS)[number];

export const BOARD_LABELS: Record<BoardPlatform, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
};

/** Public board page for a board name (stored as the source's url). */
export function boardPageUrl(platform: BoardPlatform, board: string): string {
  const b = encodeURIComponent(board);
  if (platform === 'greenhouse') return `https://job-boards.greenhouse.io/${b}`;
  if (platform === 'lever') return `https://jobs.lever.co/${b}`;
  return `https://jobs.ashbyhq.com/${b}`;
}

/** What a board link looks like, as shown in hints and errors. */
export const BOARD_LINK_HINT: Record<BoardPlatform, string> = {
  ashby: 'jobs.ashbyhq.com/<board>',
  greenhouse: 'job-boards.greenhouse.io/<board>',
  lever: 'jobs.lever.co/<site>',
};

const LINKS: Record<BoardPlatform, RegExp[]> = {
  ashby: [/^(?:https?:\/\/)?jobs\.ashbyhq\.com\/([^/?#\s]+)/i],
  greenhouse: [
    /^(?:https?:\/\/)?(?:job-boards|boards)\.greenhouse\.io\/embed\/job_board\?(?:[^#\s]*&)?for=([^&#\s]+)/i,
    /^(?:https?:\/\/)?(?:job-boards|boards)\.greenhouse\.io\/([^/?#\s]+)/i,
    /^(?:https?:\/\/)?boards-api\.greenhouse\.io\/v1\/boards\/([^/?#\s]+)/i,
  ],
  lever: [
    /^(?:https?:\/\/)?jobs\.lever\.co\/([^/?#\s]+)/i,
    /^(?:https?:\/\/)?api\.lever\.co\/v0\/postings\/([^/?#\s]+)/i,
  ],
};

function fromLink(platform: BoardPlatform, input: string): string | null {
  for (const re of LINKS[platform]) {
    const m = re.exec(input);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return null;
}

/** The platform and board of a pasted board link; null for anything else (names included). */
export function detectBoard(input: string): { platform: BoardPlatform; board: string } | null {
  const t = input.trim();
  for (const platform of BOARD_PLATFORMS) {
    const board = fromLink(platform, t);
    if (board) return { platform, board };
  }
  return null;
}

/**
 * The board name from a link of that platform or a bare name ("datadog"); null for a link of
 * another site.
 */
export function boardFrom(platform: BoardPlatform, input: string): string | null {
  const t = input.trim();
  return fromLink(platform, t) ?? (/^[^\s/?#:]+$/.test(t) ? t : null);
}
