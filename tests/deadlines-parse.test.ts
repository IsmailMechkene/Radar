import { describe, expect, it } from 'vitest';
import { parseDates, splitSentences, type ParseContext } from '../src/core/deadlines/parse';
import { zonedParts } from '../src/core/time';

const REF = new Date('2026-10-16T08:00:00.000Z');
const TZ = 'Africa/Tunis';

function localDay(iso: string, tz = TZ): string {
  const p = zonedParts(new Date(iso), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

type Brief = [kind: string, day: string | null, confidence: string];

function brief(text: string, over: Partial<ParseContext> = {}): Brief[] {
  return parseDates(text, { reference: REF, timeZone: TZ, ...over }).map((d) => [
    d.kind,
    d.date ? localDay(d.date, over.timeZone ?? TZ) : null,
    d.confidence,
  ]);
}

// Reference date: 2026-10-16 (Africa/Tunis). Year rule: on/after the reference day -> this year;
// 1-60 days before -> this year, low; more than 60 days before -> next year.
const CASES: [text: string, expected: Brief[]][] = [
  // English, explicit years and inferred ones
  ['Apply by March 31, 2027.', [['deadline', '2027-03-31', 'high']]],
  ['Application deadline: 15 January 2027', [['deadline', '2027-01-15', 'high']]],
  ['Deadline: Jan. 15', [['deadline', '2027-01-15', 'medium']]],
  ['Applications close on 30 November.', [['deadline', '2026-11-30', 'medium']]],
  ['Please submit your application by 1st December 2026.', [['deadline', '2026-12-01', 'high']]],
  ['Applications are accepted until 2027-02-28.', [['deadline', '2027-02-28', 'high']]],
  ['The closing date is 12/31/2026.', [['deadline', '2026-12-31', 'medium']]],
  ['Last day to apply: Friday, November 20th.', [['deadline', '2026-11-20', 'medium']]],
  ['Applications will close on 1 Nov 2026 at 23:59 CET.', [['deadline', '2026-11-01', 'high']]],
  ['Deadline: March 2027', [['deadline', '2027-03-31', 'low']]],
  // Rolling
  ['We review applications on a rolling basis.', [['rolling', null, 'high']]],
  ['This position is open until filled.', [['rolling', null, 'high']]],
  [
    'Rolling deadline, but apply by 15 Dec 2026 for priority.',
    [
      ['rolling', null, 'high'],
      ['deadline', '2026-12-15', 'high'],
    ],
  ],
  // Opening dates
  ['Applications open from January.', [['opens', '2027-01-01', 'medium']]],
  [
    'Applications open on March 1, 2027 and close on March 31, 2027.',
    [
      ['opens', '2027-03-01', 'high'],
      ['deadline', '2027-03-31', 'high'],
    ],
  ],
  // Ranges (a window: opens on the first day, closes on the last)
  [
    'Contributor applications: Mar 16-31.',
    [
      ['opens', '2027-03-16', 'medium'],
      ['deadline', '2027-03-31', 'medium'],
    ],
  ],
  [
    'Application period: March 16 – March 31, 2027',
    [
      ['opens', '2027-03-16', 'high'],
      ['deadline', '2027-03-31', 'high'],
    ],
  ],
  [
    'Applications open Mar 16-31.',
    [
      ['opens', '2027-03-16', 'medium'],
      ['deadline', '2027-03-31', 'medium'],
    ],
  ],
  [
    'Application window: 16 November - 4 December 2026',
    [
      ['opens', '2026-11-16', 'high'],
      ['deadline', '2026-12-04', 'high'],
    ],
  ],
  [
    'Applications accepted Dec 20 - Jan 10.',
    [
      ['opens', '2026-12-20', 'medium'],
      ['deadline', '2027-01-10', 'medium'],
    ],
  ],
  // French
  ['Date limite de candidature : 31 mars 2027.', [['deadline', '2027-03-31', 'high']]],
  ["Candidatures jusqu'au 15/11.", [['deadline', '2026-11-15', 'medium']]],
  ['Candidatures jusqu’au 05/12', [['deadline', '2026-12-05', 'medium']]],
  ['Envoyez votre candidature avant le 1er décembre 2026.', [['deadline', '2026-12-01', 'high']]],
  [
    'Les candidatures sont ouvertes à partir du 1er février 2027.',
    [['opens', '2027-02-01', 'high']],
  ],
  ['Clôture des candidatures le 20 janvier.', [['deadline', '2027-01-20', 'medium']]],
  ["Candidatures examinées au fil de l'eau.", [['rolling', null, 'high']]],
  ['Ouverture des candidatures en janvier 2027', [['opens', '2027-01-01', 'high']]],
  ['Postulez au plus tard le 10 décembre.', [['deadline', '2026-12-10', 'medium']]],
  [
    'Candidatures : du 16 au 31 mars 2027',
    [
      ['opens', '2027-03-16', 'high'],
      ['deadline', '2027-03-31', 'high'],
    ],
  ],
  ['Date limite : 31/03/2027', [['deadline', '2027-03-31', 'high']]],
  // Year inference around the reference day
  ['Deadline: October 16.', [['deadline', '2026-10-16', 'medium']]],
  ['Deadline: October 10.', [['deadline', '2026-10-10', 'low']]],
  ['Deadline: September 1', [['deadline', '2026-09-01', 'low']]],
  ['Deadline: July 31', [['deadline', '2027-07-31', 'medium']]],
  // Ambiguous numeric dates
  ['Apply by 03/04/2027.', [['deadline', '2027-04-03', 'low']]],
  ['Apply by 04/04/2027.', [['deadline', '2027-04-04', 'high']]],
  ['Posted on 2026-10-01 · Apply by 2026-11-30', [['deadline', '2026-11-30', 'high']]],
  // False positives: nothing may be parsed
  ['Founded in 2015, we are a team of 40 engineers.', []],
  ['Posted March 3.', []],
  ['The internship starts on March 1, 2027.', []],
  ['Minimum CGPA 3.5/4 required.', []],
  ['We have offices in Paris since 2019.', []],
  ['Join us in May!', []],
  ['Updated on 12/10/2026', []],
  ['Version 2.1.3 released on 1.2', []],
  ['Applications close after interviews on 3 March', []],
  ['Interviews will take place from 1 to 15 December.', []],
  ['Deadline is 29 February 2027.', []],
  ['Start date: September 2027, duration 6 months.', []],
  // Seen in a real Cohere posting: not a rolling deadline.
  ['Capable of working independently, rolling up sleeves, and driving impact.', []],
  [
    'Applications are reviewed on a rolling basis until 15 December 2026.',
    [['rolling', null, 'high']],
  ],
];

describe('deadline parser', () => {
  it('has at least 40 labelled sentences', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES)('%s', (text, expected) => {
    expect(brief(text)).toEqual(expected);
  });

  it('keeps the original sentence and says why a date is not trusted', () => {
    const [d] = parseDates('Our team is great. Deadline: October 10. Join us!', {
      reference: REF,
      timeZone: TZ,
    });
    expect(d).toMatchObject({ sentence: 'Deadline: October 10.', match: 'October 10' });
    expect(d!.note).toMatch(/no year/);
    const [n] = parseDates('Apply by 03/04/2027.', { reference: REF, timeZone: TZ });
    expect(n!.note).toBe('numeric date could be day/month or month/day');
  });

  it('reads day-first numeric dates with certainty in French or other European text', () => {
    expect(brief('Apply by 03/04/2027.', { language: 'fr' })).toEqual([
      ['deadline', '2027-04-03', 'high'],
    ]);
    expect(brief('Apply by 03/04/2027.', { language: 'other' })).toEqual([
      ['deadline', '2027-04-03', 'high'],
    ]);
  });

  it('treats a deadline as the end of that day in the user time zone', () => {
    const at = (tz: string) =>
      parseDates('Apply by 15 January 2027', { reference: REF, timeZone: tz })[0]!.date;
    expect(at('Africa/Tunis')).toBe('2027-01-15T22:59:59.999Z'); // UTC+1
    expect(at('Europe/London')).toBe('2027-01-15T23:59:59.999Z'); // GMT
    expect(at('UTC')).toBe('2027-01-15T23:59:59.999Z');
    // British summer time: end of 31 March is 22:59:59.999Z.
    expect(
      parseDates('Apply by 31 March 2027', { reference: REF, timeZone: 'Europe/London' })[0]!.date,
    ).toBe('2027-03-31T22:59:59.999Z');
  });

  it('treats an opening date as the start of that day', () => {
    const [d] = parseDates('Applications open on 1 March 2027.', {
      reference: REF,
      timeZone: 'Europe/London',
    });
    expect(d).toMatchObject({ kind: 'opens', date: '2027-03-01T00:00:00.000Z' });
  });

  it('uses the reference date, not today, to infer the year', () => {
    // A posting from 2027-02-01 saying "deadline: March 10" means 2027, read in any later year.
    expect(brief('Deadline: March 10', { reference: new Date('2027-02-01T10:00:00Z') })).toEqual([
      ['deadline', '2027-03-10', 'medium'],
    ]);
  });

  it('does not split sentences after month abbreviations', () => {
    expect(splitSentences('Apply by Mar. 31. Interviews in April.')).toEqual([
      'Apply by Mar. 31.',
      'Interviews in April.',
    ]);
    expect(brief('Apply by Mar. 31. Interviews in April.')).toEqual([
      ['deadline', '2027-03-31', 'medium'],
    ]);
  });
});
