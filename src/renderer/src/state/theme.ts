import { useEffect, useState } from 'react';
import { resolveTheme, type ResolvedTheme, type ThemePreference } from '../../../shared/theme';

const QUERY = '(prefers-color-scheme: dark)';

/** Resolves the theme (setting + OS) and writes it to <html data-theme>, which drives the tokens. */
export function useAppliedTheme(pref: ThemePreference | undefined): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(pref ?? 'system', systemDark);
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);
  return resolved;
}
