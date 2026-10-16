import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import {
  createPipelineRow,
  listPipeline,
  removePipelineRows,
  updatePipelineRow,
} from '../src/core/db/pipeline';
import { readDate } from '../src/core/deadlines/parse';
import { parseCsv } from '../src/core/pipeline/csv';
import { importPipelineCsv, mapHeaders, statusFromText } from '../src/core/pipeline/import';
import { parseSeedPrograms, syncSeedPrograms } from '../src/core/programs/seeds';
import { syncReminders } from '../src/core/reminders/store';
import { zonedParts } from '../src/core/time';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const local = (iso: string | null) => {
  if (!iso) return null;
  const p = zonedParts(new Date(iso), TZ);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
};

describe('pipeline rows', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('creates a row, trims text and turns empty strings into nothing', () => {
    const row = createPipelineRow(
      t.db,
      {
        org: ' Weaviate ',
        role: 'Backend Intern',
        contact_name: '  ',
        planned_send_date: '2026-10-21',
      },
      TZ,
      NOW,
    );
    expect(row).toMatchObject({
      org: 'Weaviate',
      role: 'Backend Intern',
      contact_name: null,
      status: 'not_started',
      planned_send_date: '2026-10-21',
      sent_at: null,
      followup1_at: null,
    });
  });

  it('marking Sent sets the sent date to now and schedules follow-ups at +7 and +14 days', () => {
    const { id } = createPipelineRow(t.db, { org: 'IAESTE Tunisia' }, TZ, NOW);
    const sent = updatePipelineRow(
      t.db,
      id,
      { status: 'sent' },
      TZ,
      new Date('2026-10-19T10:30:00Z'),
    );
    expect(sent.sent_at).toBe('2026-10-19T10:30:00.000Z');
    expect([local(sent.followup1_at), local(sent.followup2_at)]).toEqual([
      '2026-10-26 09:00',
      '2026-11-02 09:00',
    ]);
    // Moving on keeps the dates; changing the sent date moves the follow-ups.
    const later = updatePipelineRow(t.db, id, { status: 'followup_sent' }, TZ, NOW);
    expect(later.sent_at).toBe(sent.sent_at);
    const moved = updatePipelineRow(t.db, id, { sent_at: '2026-10-20T11:00:00.000Z' }, TZ, NOW);
    expect(local(moved.followup1_at)).toBe('2026-10-27 09:00');
    // Clearing the sent date clears the follow-ups (Undo of a mistaken "Sent").
    const cleared = updatePipelineRow(t.db, id, { status: 'drafted', sent_at: null }, TZ, NOW);
    expect([cleared.sent_at, cleared.followup1_at, cleared.followup2_at]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('follow-up reminders follow the row, and deleting a row deletes its reminders', () => {
    const { id } = createPipelineRow(t.db, { org: 'DeepL', role: 'Full-Stack Intern' }, TZ, NOW);
    updatePipelineRow(t.db, id, { status: 'sent' }, TZ, NOW);
    expect(syncReminders(t.db, NOW, TZ).inserted).toBe(2);
    expect(removePipelineRows(t.db, [id])).toBe(1);
    expect(t.db.prepare('SELECT COUNT(*) FROM reminders').pluck().get()).toBe(0);
  });

  it('rejects bad values', () => {
    const { id } = createPipelineRow(t.db, { org: 'X' }, TZ, NOW);
    expect(() =>
      updatePipelineRow(t.db, id, { planned_send_date: '19/10/2026' }, TZ, NOW),
    ).toThrow();
    expect(() => updatePipelineRow(t.db, id, { org: '' }, TZ, NOW)).toThrow();
    expect(() => updatePipelineRow(t.db, 999, { notes: 'x' }, TZ, NOW)).toThrow(/No pipeline row/);
  });

  it('lists by planned send date, undated rows last', () => {
    createPipelineRow(t.db, { org: 'Cohere', planned_send_date: '2027-01-18' }, TZ, NOW);
    createPipelineRow(t.db, { org: 'Later' }, TZ, NOW);
    createPipelineRow(t.db, { org: 'IAESTE Tunisia', planned_send_date: '2026-10-19' }, TZ, NOW);
    expect(listPipeline(t.db).map((r) => r.org)).toEqual(['IAESTE Tunisia', 'Cohere', 'Later']);
  });
});

describe('CSV', () => {
  it('reads quotes, embedded commas and line breaks, BOM, CRLF and semicolons', () => {
    expect(parseCsv('\uFEFFa,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n').rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
    ]);
    expect(parseCsv('Org;Date\nDeepL;22/10/2026').rows).toEqual([
      ['Org', 'Date'],
      ['DeepL', '22/10/2026'],
    ]);
    expect(parseCsv('a,"b\n').problems).toHaveLength(1);
  });

  it('maps English and French headers and lists the others', () => {
    const { map, ignored } = mapHeaders([
      'Organisme',
      'Poste',
      'Statut',
      'Date prévue',
      'Envoyé le',
      'E-mail',
      'Priority',
    ]);
    expect(map).toEqual({
      org: 0,
      role: 1,
      status: 2,
      planned_send_date: 3,
      sent_at: 4,
      contact_url: 5,
    });
    expect(ignored).toEqual(['Priority']);
  });

  it('reads statuses in English and French', () => {
    expect(statusFromText('Follow-up sent')).toBe('followup_sent');
    expect(statusFromText('Envoyé')).toBe('sent');
    expect(statusFromText('Not eligible')).toBe('not_eligible');
    expect(statusFromText('Maybe later')).toBeNull();
  });

  it('reads one date per cell, day-first', () => {
    const ctx = { reference: NOW, timeZone: TZ, language: 'fr' as const };
    expect(readDate('2026-10-19', ctx)?.date).toBe('2026-10-19');
    expect(readDate('19/10/2026', ctx)?.date).toBe('2026-10-19');
    expect(readDate('03/04/2027', ctx)).toEqual({ date: '2027-04-03', confidence: 'high' });
    expect(readDate('Oct 19', ctx)?.date).toBe('2026-10-19');
    expect(readDate('11 janvier 2027', ctx)?.date).toBe('2027-01-11');
    expect(readDate('Mar 16', ctx)?.date).toBe('2027-03-16');
    expect(readDate('soon', ctx)).toBeNull();
    expect(readDate('Oct 19 or 20', ctx)).toBeNull();
  });
});

describe('importPipelineCsv', () => {
  let t: ReturnType<typeof tempDb>;
  const csv = readFileSync(
    join(__dirname, '..', 'fixtures', 'pipeline', 'outreach-tracker.csv'),
    'utf8',
  );
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    const programs = parseSeedPrograms(
      JSON.parse(readFileSync(join(__dirname, '..', 'seeds', 'programs.json'), 'utf8')),
    );
    syncSeedPrograms(t.db, programs, TZ, NOW);
  });
  afterEach(() => t.cleanup());

  it('imports the tracker, links programs and reports what it could not read', () => {
    const r = importPipelineCsv(t.db, csv, TZ, NOW);
    expect(r.added).toBe(13);
    expect(r.skipped).toBe(0);
    expect(r.ignoredColumns).toEqual(['Priority']);
    expect(r.problems).toEqual([
      'Line 9: no organization, row not imported.',
      'Line 13 (Mistral AI): planned send date "early Jan" not understood, left empty.',
      'Line 14 (Cohere): status "Waiting" not recognized, imported as Not started.',
    ]);
    const rows = listPipeline(t.db);
    const by = (org: string) => rows.find((x) => x.org === org)!;
    expect(by('IAESTE Tunisia')).toMatchObject({
      planned_send_date: '2026-10-19',
      status: 'not_started',
      program_name: 'IAESTE Tunisia',
    });
    expect(by('Erasmus+ office').program_name).toBe('Erasmus+ International Credit Mobility');
    expect(by('InstaDeep Tunis').program_name).toBe('InstaDeep Tunis PFE');
    expect(by('Weaviate').program_name).toBeNull();
    // A sent date makes the row Sent with follow-ups.
    expect(by('Photoroom')).toMatchObject({ status: 'sent' });
    expect(local(by('Photoroom').followup1_at)).toBe('2026-10-20 09:00');
    expect(by('Google Summer of Code').planned_send_date).toBe('2027-03-16');
  });

  it('re-importing the same file adds nothing', () => {
    importPipelineCsv(t.db, csv, TZ, NOW);
    const again = importPipelineCsv(t.db, csv, TZ, NOW);
    expect(again).toMatchObject({ added: 0, skipped: 13 });
  });

  it('refuses a file without an organization column, naming what it found', () => {
    expect(() => importPipelineCsv(t.db, 'Who,When\nX,today', TZ, NOW)).toThrow(
      /No organization column.*Found: "Who", "When"/,
    );
    expect(() => importPipelineCsv(t.db, '', TZ, NOW)).toThrow(/empty/);
  });
});
