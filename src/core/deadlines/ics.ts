// iCalendar export (RFC 5545) so deadlines also show in a phone calendar. Pure: events and the
// clock come in, text goes out. Each deadline is an all-day event on its local calendar day, with
// an alarm the day before; expected dates say so in the title.
import { zonedParts } from '../time';
import type { DeadlineEvent } from './list';

/** Escapes TEXT values (backslash, semicolon, comma, newline). */
export function icsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds content lines longer than 75 octets (UTF-8), continuation lines start with a space. */
export function foldLine(line: string): string {
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (bytes(current + ch) > limit) {
      parts.push(current);
      current = ch;
    } else current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

function localDay(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

function nextDay(yyyymmdd: string): string {
  const d = new Date(
    Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + 1),
  );
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function eventSummary(e: DeadlineEvent): string {
  const what = e.event === 'opens' ? 'Window opens' : 'Deadline';
  const who = e.org && e.org !== e.title ? `${e.org}: ${e.title}` : e.title;
  return `${what} · ${who}${e.status === 'expected' ? ' (expected, from last cycle)' : ''}`;
}

/** One VCALENDAR with every event. Stable UIDs, so re-importing updates instead of duplicating. */
export function toIcs(events: readonly DeadlineEvent[], timeZone: string, now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Radar//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Radar deadlines',
  ];
  for (const e of events) {
    const day = localDay(e.at, timeZone);
    const description = [
      e.status === 'expected'
        ? 'Expected date copied from the last cycle, not confirmed yet.'
        : null,
      e.sentence ? `“${e.sentence}”` : null,
      e.url,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:radar-${e.key.replace(/:/g, '-')}@radar.local`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${nextDay(day)}`,
      `SUMMARY:${icsText(eventSummary(e))}`,
      ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(eventSummary(e))}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
