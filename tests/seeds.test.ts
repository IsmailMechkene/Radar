import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSeedSource, parseSeedSources, seedSourcesFileSchema } from '../src/core/sources/seeds';

const raw = JSON.parse(readFileSync(join(__dirname, '../seeds/sources.json'), 'utf8')) as {
  version: 1;
  sources: Record<string, unknown>[];
};

describe('seeds/sources.json', () => {
  const sources = parseSeedSources(raw);

  it('is valid: every active source has an adapter and a valid config', () => {
    // parseSeedSources validated each config against its adapter; these were checked live.
    const active = sources.filter((s) => s.status === 'active');
    expect(active.length).toBeGreaterThan(80);
    expect(new Set(active.map((s) => s.kind))).toEqual(
      new Set(['ashby', 'arbeitnow', 'greenhouse', 'lever', 'recruitee']),
    );
    for (const s of active) {
      expect(s.url, s.name).toMatch(/^https:\/\//);
      expect(s.tos_note, s.name).toBeTruthy();
    }
  });

  it('one source per board, the spike boards included', () => {
    const board = (s: (typeof sources)[number]) =>
      `${s.kind}:${String(s.config['board'] ?? s.config['site'] ?? '')}`;
    const boards = sources
      .filter((s) => s.kind !== 'arbeitnow' && s.status === 'active')
      .map(board);
    expect(new Set(boards).size).toBe(boards.length);
    expect(boards).toEqual(
      expect.arrayContaining([
        'ashby:cohere',
        'ashby:DeepL',
        'ashby:mistral.ai',
        'ashby:photoroom',
        'ashby:weaviate',
      ]),
    );
  });

  it('Arbeitnow links back to arbeitnow.com', () => {
    expect(findSeedSource(sources, 'arbeitnow INTERNSHIPS')?.url).toBe('https://www.arbeitnow.com');
  });

  it('InstaDeep and Entrelacs are pending with a note', () => {
    for (const name of ['InstaDeep', 'Entrelacs']) {
      const s = findSeedSource(sources, name);
      expect(s?.status).toBe('pending');
      expect(s?.note).toBeTruthy();
    }
  });

  it('rejects duplicates, unknown adapters and bad configs', () => {
    const bad = (sources: Record<string, unknown>[]) =>
      seedSourcesFileSchema.safeParse({ version: 1, sources }).success;
    const cohere = raw.sources[0]!;
    expect(bad([cohere, { ...cohere, name: 'cohere' }])).toBe(false);
    expect(bad([{ ...cohere, kind: 'remotive' }])).toBe(false);
    expect(bad([{ ...cohere, config: { board: 'cohere' } }])).toBe(false); // missing org
    expect(bad([{ ...cohere, kind: 'remotive', status: 'pending' }])).toBe(true); // pending: no adapter needed
  });
});
