// Picks the native window backdrop. Pure so it can be unit tested without Electron.

export type WindowMaterial = 'mica' | 'vibrancy' | 'none';

/** Windows 11 22H2 (build 22621) is the first release where Electron's backgroundMaterial works. */
export const MICA_MIN_BUILD = 22621;

export function chooseWindowMaterial(platform: string, osRelease: string): WindowMaterial {
  if (platform === 'darwin') return 'vibrancy';
  if (platform === 'win32') {
    const build = Number(osRelease.split('.')[2]);
    return Number.isFinite(build) && build >= MICA_MIN_BUILD ? 'mica' : 'none';
  }
  return 'none';
}
