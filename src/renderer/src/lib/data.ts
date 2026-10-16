// Settings > Data: how the backups folder line reads. Pure: the clock is passed in.
import type { BackupInfo } from '../../../shared/ipc';
import { calendarDaysBetween } from './dates';

/** "C:\Users\me\Documents\Radar" -> "…\Documents\Radar" when long (the full path is the tooltip). */
export function shortPath(path: string, max = 46): string {
  if (path.length <= max) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep);
  let out = parts[parts.length - 1] ?? path;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}${sep}${out}`;
    if (next.length + 2 > max) break;
    out = next;
  }
  return `…${sep}${out}`;
}

/** "last backup today 09:12 · 3 kept" / "no backup yet". */
export function lastBackupLine(info: BackupInfo, now: Date, timeZone: string): string {
  if (!info.last) return 'no backup yet; one is made automatically each day';
  const at = new Date(info.last.modifiedAt);
  const days = calendarDaysBetween(at, now, timeZone);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const when =
    days === 0
      ? `today ${time}`
      : days === 1
        ? `yesterday ${time}`
        : new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(at);
  return `last backup ${when} · ${info.count} kept`;
}
