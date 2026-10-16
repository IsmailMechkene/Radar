import { describe, expect, it } from 'vitest';
import type { PipelineItem } from '../src/core/db/pipeline';
import {
  draftOf,
  EMPTY_DRAFT,
  followupChips,
  followupsDue,
  formatLocalDate,
  fromDateInput,
  patchOf,
  pipelineSubtitle,
  roleOf,
  statusCounts,
  toDateInput,
} from '../src/renderer/src/lib/pipeline';

const TZ = 'Africa/Tunis';
const base: PipelineItem = {
  id: 1,
  opportunity_id: null,
  program_id: null,
  org: 'Weaviate',
  role: null,
  status: 'sent',
  planned_send_date: '2026-10-21',
  sent_at: '2026-10-21T10:00:00.000Z',
  followup1_at: '2026-10-28T08:00:00.000Z',
  followup2_at: '2026-11-04T08:00:00.000Z',
  contact_name: null,
  contact_url: null,
  notes: null,
  updated_at: '2026-10-21T10:00:00.000Z',
  opportunity_title: null,
  opportunity_url: null,
  program_name: null,
};
const at = (iso: string) => new Date(iso);

describe('pipeline display', () => {
  it('shows "After sending" before anything is sent', () => {
    expect(
      followupChips(
        { ...base, status: 'drafted', sent_at: null, followup1_at: null, followup2_at: null },
        at('2026-10-22T00:00:00Z'),
        TZ,
      ),
    ).toEqual([{ label: 'After sending', tone: 'none' }]);
  });

  it('shows upcoming follow-ups, then the due one alone while still Sent', () => {
    expect(followupChips(base, at('2026-10-22T00:00:00Z'), TZ)).toEqual([
      { label: '+7 Oct 28', tone: 'upcoming' },
      { label: '+14 Nov 4', tone: 'upcoming' },
    ]);
    expect(followupChips(base, at('2026-10-28T09:00:00Z'), TZ)).toEqual([
      { label: 'Follow-up due Oct 28', tone: 'due' },
    ]);
  });

  it('after "Follow-up sent" the first is done and the second still counts', () => {
    const item = { ...base, status: 'followup_sent' as const };
    expect(followupChips(item, at('2026-10-30T00:00:00Z'), TZ)).toEqual([
      { label: '+7 Oct 28', tone: 'done' },
      { label: '+14 Nov 4', tone: 'upcoming' },
    ]);
    expect(followupChips(item, at('2026-11-05T00:00:00Z'), TZ)[0]!.tone).toBe('due');
  });

  it('once the row moved on (interview), nothing is due and future follow-ups disappear', () => {
    const item = { ...base, status: 'interview' as const };
    expect(followupChips(item, at('2026-10-30T00:00:00Z'), TZ)).toEqual([
      { label: '+7 Oct 28', tone: 'done' },
    ]);
    expect(followupsDue([item], at('2026-11-05T00:00:00Z'), TZ)).toBe(0);
  });

  it('counts, subtitle and role fallback', () => {
    const items = [base, { ...base, id: 2, status: 'drafted' as const }];
    expect(statusCounts(items)).toMatchObject({ sent: 1, drafted: 1, offer: 0 });
    expect(pipelineSubtitle(items, 1)).toBe('2 entries · 1 follow-up due');
    expect(pipelineSubtitle([base], 0)).toBe('1 entry');
    expect(roleOf({ ...base, program_name: 'KAUST VSRP' })).toBe('KAUST VSRP');
    expect(roleOf({ ...base, role: 'Backend Intern', opportunity_title: 'X' })).toBe(
      'Backend Intern',
    );
  });

  it('formats calendar days without a time zone shift', () => {
    expect(formatLocalDate('2026-10-19')).toBe('Oct 19');
    // 23:30Z on Oct 19 is already Oct 20 in Tunis.
    expect(toDateInput('2026-10-19T23:30:00.000Z', TZ)).toBe('2026-10-20');
    expect(fromDateInput('2026-10-20', TZ)).toBe('2026-10-20T11:00:00.000Z');
    expect(fromDateInput('', TZ)).toBeNull();
  });
});

describe('drawer patch', () => {
  it('sends only what changed', () => {
    const before = draftOf(base, TZ);
    expect(patchOf(before, before, TZ)).toEqual({});
    expect(
      patchOf({ ...before, notes: 'Asked about Go client', status: 'followup_sent' }, before, TZ),
    ).toEqual({
      notes: 'Asked about Go client',
      status: 'followup_sent',
    });
    expect(patchOf({ ...before, sent: '2026-10-22', planned: '' }, before, TZ)).toEqual({
      sent_at: '2026-10-22T11:00:00.000Z',
      planned_send_date: null,
    });
  });

  it('ignores whitespace-only edits and builds a new entry from the empty draft', () => {
    const before = draftOf(base, TZ);
    expect(patchOf({ ...before, org: ' Weaviate ' }, before, TZ)).toEqual({});
    expect(
      patchOf({ ...EMPTY_DRAFT, org: 'Entrelacs', planned: '2026-10-20' }, EMPTY_DRAFT, TZ),
    ).toEqual({
      org: 'Entrelacs',
      planned_send_date: '2026-10-20',
    });
  });
});
