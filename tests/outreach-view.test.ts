import { describe, expect, it } from 'vitest';
import type { PipelineItem } from '../src/core/db/pipeline';
import type { OutreachItem, TemplateRow } from '../src/core/outreach';
import {
  alreadyEmailed,
  draftFields,
  isSharedField,
  orgStatus,
  parts,
  templateFor,
  valuesFor,
} from '../src/renderer/src/lib/outreach';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-30T09:00:00.000Z');
const row: PipelineItem = {
  id: 1,
  opportunity_id: null,
  program_id: null,
  org: 'Weaviate',
  role: 'Backend Engineer Intern',
  status: 'not_started',
  planned_send_date: '2026-10-21',
  sent_at: null,
  followup1_at: null,
  followup2_at: null,
  contact_name: 'Talent team',
  contact_url: 'jobs@weaviate.io',
  notes: null,
  updated_at: '2026-10-16T08:00:00.000Z',
  opportunity_title: null,
  opportunity_url: null,
  program_name: null,
};
const item = (
  over: Partial<PipelineItem> = {},
  rest: Partial<OutreachItem> = {},
): OutreachItem => ({
  row: { ...row, ...over },
  template_id: null,
  fields: {},
  auto: { company: 'Weaviate', role: 'Backend Engineer Intern', email: 'jobs@weaviate.io' },
  ...rest,
});
const tpl = (id: number, kind: 'cold' | 'followup'): TemplateRow => ({
  id,
  name: `T${id}`,
  kind,
  subject: 'Re: [role] at [company]',
  body: 'Hi [first name], [project]. [my name]',
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
});
const templates = [tpl(1, 'cold'), tpl(2, 'followup')];
const sent = {
  status: 'sent' as const,
  sent_at: '2026-10-19T10:00:00.000Z',
  followup1_at: '2026-10-26T08:00:00.000Z',
  followup2_at: '2026-11-02T08:00:00.000Z',
};

describe('outreach page rules', () => {
  it('values: pipeline, then shared, then typed', () => {
    const v = valuesFor(item({}, { fields: { role: 'ML Intern', project: 'RAG demo' } }), {
      'my name': 'Ismail',
    });
    expect(v).toMatchObject({
      company: 'Weaviate',
      role: 'ML Intern',
      project: 'RAG demo',
      'my name': 'Ismail',
    });
    expect(isSharedField('My School')).toBe(true);
    expect(isSharedField('company')).toBe(false);
  });

  it('template: the chosen one, else follow-up once emailed, else the first cold one', () => {
    expect(templateFor(item(), templates)?.id).toBe(1);
    expect(templateFor(item(sent), templates)?.id).toBe(2);
    expect(templateFor(item(sent, { template_id: 1 }), templates)?.id).toBe(1);
    expect(draftFields(templates[0]!)).toEqual([
      'email',
      'role',
      'company',
      'first name',
      'project',
      'my name',
    ]);
  });

  it('list status and the already-emailed warning', () => {
    expect(orgStatus(item(), true, NOW, TZ)).toEqual({ label: 'Draft ready', tone: 'muted' });
    expect(orgStatus(item(), false, NOW, TZ).label).toBe('Not started');
    expect(orgStatus(item(sent), false, NOW, TZ)).toEqual({
      label: 'Follow-up due Oct 26',
      tone: 'amber',
    });
    expect(
      orgStatus(item({ ...sent, followup1_at: '2026-11-05T08:00:00.000Z' }), false, NOW, TZ),
    ).toEqual({ label: 'Emailed Oct 19', tone: 'amber' });
    expect(orgStatus(item({ status: 'interview' }), false, NOW, TZ)).toEqual({
      label: 'Interview',
      tone: 'green',
    });
    expect(alreadyEmailed(item(sent), templates[0]!, NOW, TZ)).toEqual({
      title: 'You already emailed this organization on Oct 19.',
      detail: 'A follow-up was due Oct 26.',
    });
    expect(alreadyEmailed(item(sent), templates[1]!, NOW, TZ)).toBeNull(); // writing the follow-up
    expect(alreadyEmailed(item(), templates[0]!, NOW, TZ)).toBeNull();
  });

  it('preview parts mark filled and missing fields', () => {
    expect(parts('Hi [first name], see [company].', { company: 'Weaviate' })).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'field', name: 'first name', value: null },
      { kind: 'text', text: ', see ' },
      { kind: 'field', name: 'company', value: 'Weaviate' },
      { kind: 'text', text: '.' },
    ]);
  });
});
