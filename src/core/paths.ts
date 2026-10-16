// Where Radar keeps its data when run headless (CLI, OS scheduler). Matches Electron's
// app.getPath('userData') for the app name "radar", so the CLI and the app share one database.
import { join } from 'node:path';

export function defaultDataDir(
  platform: string,
  env: Record<string, string | undefined>,
  home: string,
): string {
  if (platform === 'win32')
    return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'radar');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'radar');
  return join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'radar');
}
