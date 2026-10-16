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
    expect(sources.filter((s) => s.status === 'active').map((s) => s.name)).toEqual([
      'Cohere',
      'DeepL',
      'Mistral AI',
      'Photoroom',
      'Weaviate',
      'Arbeitnow internships',
    ]);
  });

  it('one Ashby source per organization with the board from the spike', () => {
    const boards = sources.filter((s) => s.kind === 'ashby').map((s) => s.config['board']);
    expect(boards).toEqual(['cohere', 'DeepL', 'mistral.ai', 'photoroom', 'weaviate']);
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
