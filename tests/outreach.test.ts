import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { createPipelineRow, removePipelineRows, updatePipelineRow } from '../src/core/db/pipeline';
import {
  autoFields,
  deleteTemplate,
  ensureDefaultTemplates,
  fieldsIn,
  firstNameOf,
  listOutreach,
  listTemplates,
  mailtoUrl,
  render,
  saveDraft,
  saveTemplate,
} from '../src/core/outreach';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');

describe('merge fields', () => {
  it('finds fields once, in order, case-insensitively', () => {
    expect(fieldsIn('Re: [Role] at [company]', 'Hi [first name], [company] [role]')).toEqual([
      'role',
      'company',
      'first name',
    ]);
    expect(fieldsIn('No fields, [ ] or [] here')).toEqual([]);
  });

  it('renders known values and reports missing ones (left as [field])', () => {
    const r = render('Internship at [company]', 'Hi [First Name],\nI used [product].', {
      company: 'Mistral AI',
      'first name': 'Léa',
    });
    expect(r).toEqual({
      subject: 'Internship at Mistral AI',
      body: 'Hi Léa,\nI used [product].',
      missing: ['product'],
    });
    expect(render('[x]', '', { x: '  ' }).missing).toEqual(['x']);
  });

  it('guesses a first name only from a person', () => {
    expect(firstNameOf('Leila Martin')).toBe('Leila');
    expect(firstNameOf('Talent team')).toBeNull();
    expect(firstNameOf('L. Martin')).toBeNull();
    expect(firstNameOf('jobs@weaviate.io')).toBeNull();
    expect(firstNameOf('International office')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it('builds a mailto link with an encoded subject and CRLF body', () => {
    expect(mailtoUrl('jobs@weaviate.io', 'Intern & co', 'Hi,\nThanks')).toBe(
      'mailto:jobs@weaviate.io?subject=Intern%20%26%20co&body=Hi%2C%0D%0AThanks',
    );
    expect(mailtoUrl('Talent team', 'S', 'B')).toBe('mailto:?subject=S&body=B');
  });
});

describe('outreach data', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
  });
  afterEach(() => t.cleanup());

  it('seeds three default templates once', () => {
    expect(ensureDefaultTemplates(t.db, NOW)).toBe(3);
    expect(ensureDefaultTemplates(t.db, NOW)).toBe(0);
    const list = listTemplates(t.db);
    expect(list.map((x) => [x.name, x.kind])).toEqual([
      ['Internship, cold email', 'cold'],
      ['Candidature de stage (FR)', 'cold'],
      ['Follow-up', 'followup'],
    ]);
    expect(fieldsIn(list[0]!.subject, list[0]!.body)).toEqual([
      'product',
      'first name',
      'my school',
      'project',
      'role',
      'company',
      'my name',
    ]);
  });

  it('edits, creates and deletes templates, keeping at least one', () => {
    ensureDefaultTemplates(t.db, NOW);
    const [first, ...rest] = listTemplates(t.db);
    const edited = saveTemplate(
      t.db,
      first!.id,
      { name: first!.name, kind: first!.kind, body: first!.body, subject: 'New subject [company]' },
      NOW,
    );
    expect(edited.subject).toBe('New subject [company]');
    expect(() =>
      saveTemplate(t.db, null, { name: first!.name, kind: 'cold', subject: 's', body: 'b' }, NOW),
    ).toThrow(/already exists/);
    expect(() =>
      saveTemplate(t.db, null, { name: 'Empty', kind: 'cold', subject: '', body: 'b' }, NOW),
    ).toThrow();
    for (const r of rest) deleteTemplate(t.db, r.id);
    expect(() => deleteTemplate(t.db, first!.id)).toThrow(/at least one/);
  });

  it('fills what the pipeline knows and keeps what the user typed', () => {
    ensureDefaultTemplates(t.db, NOW);
    const row = createPipelineRow(
      t.db,
      {
        org: 'Weaviate',
        role: 'Backend Engineer Intern',
        contact_name: 'Talent team',
        contact_url: 'jobs@weaviate.io',
      },
      TZ,
      NOW,
    );
    expect(autoFields(row, TZ)).toEqual({
      company: 'Weaviate',
      role: 'Backend Engineer Intern',
      email: 'jobs@weaviate.io',
    });
    const sent = updatePipelineRow(
      t.db,
      row.id,
      { status: 'sent', sent_at: '2026-10-19T10:00:00.000Z' },
      TZ,
      NOW,
    );
    expect(autoFields(sent, TZ)['sent date']).toBe('19 October');

    const tpl = listTemplates(t.db)[0]!;
    saveDraft(
      t.db,
      row.id,
      {
        template_id: tpl.id,
        fields: { product: 'the Go client', project: '', 'First Name': 'Bob' },
      },
      NOW,
    );
    const [item] = listOutreach(t.db, TZ);
    expect(item).toMatchObject({
      template_id: tpl.id,
      fields: { product: 'the Go client', 'first name': 'Bob' },
    });
    expect(item!.fields).not.toHaveProperty('project'); // empty values are not stored
    expect(() => saveDraft(t.db, 999, { template_id: null, fields: {} }, NOW)).toThrow(
      /No pipeline row/,
    );
    // Deleting the pipeline row deletes its draft.
    removePipelineRows(t.db, [row.id]);
    expect(t.db.prepare('SELECT COUNT(*) FROM outreach_drafts').pluck().get()).toBe(0);
  });
});
