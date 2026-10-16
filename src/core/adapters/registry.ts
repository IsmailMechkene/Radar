// Adapter kind -> implementation. New sources register here.
import { arbeitnowAdapter } from './arbeitnow';
import { ashbyAdapter } from './ashby';
import type { Adapter } from './types';

export const ADAPTERS: Readonly<Record<string, Adapter>> = {
  [ashbyAdapter.kind]: ashbyAdapter as Adapter,
  [arbeitnowAdapter.kind]: arbeitnowAdapter as Adapter,
};

export function getAdapter(kind: string): Adapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) {
    throw new Error(`No adapter for kind "${kind}". Known: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}
