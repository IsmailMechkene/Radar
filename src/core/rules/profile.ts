import type { Settings } from '../settings/schema';
import type { ScoringProfile } from './engine';

/** Settings keys that change scores; changing one triggers a re-score. */
export const SCORING_SETTING_KEYS = [
  'searchMode',
  'rolesOfInterest',
  'targetRegions',
  'remotePreference',
  'grade',
] as const satisfies readonly (keyof Settings)[];

export function profileFromSettings(s: Settings): ScoringProfile {
  return {
    searchMode: s.searchMode,
    rolesOfInterest: s.rolesOfInterest,
    targetRegions: s.targetRegions,
    remotePreference: s.remotePreference,
    gradeRaw: s.grade.raw,
  };
}
