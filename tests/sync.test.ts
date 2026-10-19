import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { migrations } from '../src/core/db/migrations';
import {
  addOpportunitiesToPipeline,
  createPipelineRow,
  listPipeline,
  removePipelineRows,
  updatePipelineRow,
} from '../src/core/db/pipeline';
import { addManualDeadline, removeManualDeadline } from '../src/core/deadlines/list';
import {
  ensureDefaultTemplates,
  listTemplates,
  saveDraft,
  saveTemplate,
} from '../src/core/outreach';
import { createProgram, listPrograms } from '../src/core/programs/manage';
import { saveUserRules } from '../src/core/rules/store';
import { getSetting, seedDefaultSettings, setSetting } from '../src/core/settings/store';
import { addSource, listSourceItems } from '../src/core/sources/manage';
import { recordId, syncKeys, syncRoot, unseal, type SyncKeys } from '../src/core/sync/crypto';
import { syncOnce, type OutgoingRecord, type SyncRemote } from '../src/core/sync/engine';
import { SYNCED_SETTINGS } from '../src/core/sync/entities';
import { pendingChanges, quietly } from '../src/core/sync/state';
import { sql as migration12 } from '../src/core/db/migrations/012_sync';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const T0 = new Date('2026-10-19T08:00:00.000Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** Behaves like sync_push / the select in Supabase: newest version per id, seq per write. */
function fakeServer() {
  const rows = new Map<string, { seq: number; updatedAt: string; ciphertext: string }>();
  let seq = 0;
  const remote: SyncRemote = {
    pull: async (after, limit) =>
      [...rows.entries()]
        .map(([id, r]) => ({ id, seq: r.seq, ciphertext: r.ciphertext }))
        .filter((r) => r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit),
    push: async (records: OutgoingRecord[]) => {
      for (const r of records) {
        const stored = rows.get(r.id);
        if (stored && new Date(stored.updatedAt) > new Date(r.updatedAt)) continue;
        rows.set(r.id, { seq: ++seq, updatedAt: r.updatedAt, ciphertext: r.ciphertext });
      }
    },
  };
  return { rows, remote };
}

/** A device: its own database, set up like the app does at startup. */
function device(): Database.Database {
  const t = tempDb();
  cleanups.push(t.cleanup);
  migrate(t.db, () => T0);
  seedDefaultSettings(t.db);
  quietly(t.db, () => ensureDefaultTemplates(t.db, T0));
  return t.db;
}

const accountKeys = (): SyncKeys => syncKeys(syncRoot(randomBytes(32)));

function addPosting(db: Database.Database, key: string, title: string): number {
  const src = db
    .prepare(
      `INSERT INTO sources (kind, name, access_method, created_at) VALUES ('test', ?, 'api', ?) RETURNING id`,
    )
    .get(`src-${key}`, T0.toISOString()) as { id: number };
  return (
    db
      .prepare(
        `INSERT INTO opportunities (dedupe_key, source_id, org, title, opportunity_type, url,
           first_seen_at, last_seen_at) VALUES (?, ?, 'Mistral AI', ?, 'internship', 'https://x.test', ?, ?)
         RETURNING id`,
      )
      .get(key, src.id, title, T0.toISOString(), T0.toISOString()) as { id: number }
  ).id;
}

const changes = (db: Database.Database) =>
  pendingChanges(db)
    .map((c) => `${c.entity}${c.deleted ? ' (deleted)' : ''}`)
    .sort();

describe('change log (migration 12)', () => {
  it('logs what the user changes, not defaults, seeds or scan bookkeeping', () => {
    const db = device();
    expect(changes(db)).toEqual([]); // defaults inserted quietly, settings seeded by insert
    const row = createPipelineRow(db, { org: 'Mistral AI' }, TZ, T0);
    expect(db.prepare('SELECT uuid FROM pipeline WHERE id = ?').pluck().get(row.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    setSetting(db, 'timezone', 'Europe/Paris');
    setSetting(db, 'theme', 'dark'); // this computer only
    setSetting(db, 'opportunitiesSeenAt', T0.toISOString());
    const src = db
      .prepare(
        `INSERT INTO sources (kind, name, access_method, created_at) VALUES ('x', 'Seed', 'api', ?) RETURNING id`,
      )
      .get(T0.toISOString()) as { id: number };
    db.prepare('UPDATE sources SET last_ok_at = ? WHERE id = ?').run(T0.toISOString(), src.id);
    expect(changes(db)).toEqual(['pipeline', 'setting']);

    removePipelineRows(db, [row.id]);
    expect(changes(db)).toEqual(['pipeline (deleted)', 'setting']);
  });

  it('every synced setting is logged by the trigger, and nothing else', () => {
    for (const key of SYNCED_SETTINGS) expect(migration12).toContain(`'${key}'`);
    expect(migration12).not.toContain(`'theme'`);
  });

  it('queues rows that existed before the upgrade, so the first sync uploads them', () => {
    const t = tempDb();
    cleanups.push(t.cleanup);
    migrate(t.db, () => T0, migrations.slice(0, 11));
    seedDefaultSettings(t.db);
    ensureDefaultTemplates(t.db, T0);
    createPipelineRow(t.db, { org: 'Old row' }, TZ, T0);
    migrate(t.db, () => T0);
    const c = changes(t.db);
    expect(c.filter((x) => x === 'template')).toHaveLength(3);
    expect(c).toContain('pipeline');
    expect(c.filter((x) => x === 'setting')).toHaveLength(SYNCED_SETTINGS.length);
    expect(t.db.prepare('SELECT COUNT(*) FROM pipeline WHERE uuid IS NULL').pluck().get()).toBe(0);
  });
});

describe('sync between two devices', () => {
  it('moves the user’s rows to another device, encrypted on the way', async () => {
    const keys = accountKeys();
    const server = fakeServer();
    const a = device();
    const b = device();

    const opp = addPosting(a, 'mistral-intern', 'ML Engineer Intern');
    const [pid] = addOpportunitiesToPipeline(a, [opp], T0).added;
    updatePipelineRow(a, pid!, { status: 'drafted', notes: 'Ask Léa' }, TZ, T0);
    const own = createPipelineRow(a, { org: 'CERN', role: 'Summer student' }, TZ, T0);
    const tpl = listTemplates(a)[0]!;
    saveTemplate(
      a,
      tpl.id,
      { name: tpl.name, kind: tpl.kind, subject: tpl.subject, body: 'Edited on A' },
      later(1),
    );
    saveDraft(a, own.id, { template_id: tpl.id, fields: { product: 'LHC' } }, T0);
    addManualDeadline(a, { title: 'Visa appointment', date: '2026-11-02' }, TZ, T0);
    setSetting(a, 'rolesOfInterest', ['Robotics intern']);
    setSetting(a, 'theme', 'dark');
    saveUserRules(a, (await import('../seeds/rules.json')).default, T0);
    addSource(a, { type: 'greenhouse', board: 'acme', org: 'Acme' }, T0);
    createProgram(a, { name: 'My lab program', url: 'https://lab.test/apply' }, TZ, T0);

    await syncOnce(a, server.remote, { keys, now: () => later(2) });
    expect(changes(a)).toEqual([]);

    // The server holds ciphertext under opaque ids only.
    for (const [id, r] of server.rows) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      const bytes = Buffer.from(r.ciphertext, 'base64').toString('latin1');
      for (const secret of ['Mistral', 'CERN', 'Visa', 'Robotics', 'Acme', 'pipeline']) {
        expect(bytes).not.toContain(secret);
      }
    }

    const r = await syncOnce(b, server.remote, { keys, now: () => later(3) });
    expect(r.failed).toEqual([]);
    expect([...r.changed].sort()).toEqual(
      ['draft', 'manual', 'pipeline', 'program', 'rules', 'setting', 'source', 'template'].sort(),
    );
    const rows = listPipeline(b);
    expect(rows.map((x) => x.org).sort()).toEqual(['CERN', 'Mistral AI']);
    const linked = rows.find((x) => x.org === 'Mistral AI')!;
    // B has never seen the posting: the title stands in as the role, the link is kept for later.
    expect(linked).toMatchObject({
      opportunity_id: null,
      role: 'ML Engineer Intern',
      notes: 'Ask Léa',
    });
    expect(
      b.prepare('SELECT opportunity_key FROM pipeline WHERE id = ?').pluck().get(linked.id),
    ).toBe('mistral-intern');
    expect(listTemplates(b).find((t) => t.name === tpl.name)?.body).toBe('Edited on A');
    expect(listTemplates(b)).toHaveLength(3); // the same default under two ids became one
    const draft = b.prepare('SELECT fields_json FROM outreach_drafts').pluck().get();
    expect(JSON.parse(draft as string)).toEqual({ product: 'LHC' });
    expect(b.prepare('SELECT title FROM manual_deadlines').pluck().all()).toEqual([
      'Visa appointment',
    ]);
    expect(getSetting(b, 'rolesOfInterest')).toEqual(['Robotics intern']);
    expect(getSetting(b, 'theme')).toBe('system');
    expect(b.prepare('SELECT COUNT(*) FROM user_rules').pluck().get()).toBe(1);
    expect(listSourceItems(b).some((s) => s.name === 'Acme' && s.added_by_user)).toBe(true);
    const program = listPrograms(b).find((p) => p.name === 'My lab program');
    expect(program?.url).toBe('https://lab.test/apply');
    expect(program?.watch_url).toBe('https://lab.test/apply'); // its page is watched here too

    // Applying pulled rows logs nothing (no echo back up).
    expect(changes(b).filter((c) => c !== 'template' && c !== 'template (deleted)')).toEqual([]);
  });

  it('syncs deletions, and the newer of two edits wins on both devices', async () => {
    const keys = accountKeys();
    const server = fakeServer();
    const a = device();
    const b = device();
    const row = createPipelineRow(a, { org: 'Datadog' }, TZ, T0);
    const id = addManualDeadline(a, { title: 'Forum', date: '2026-11-10' }, TZ, T0);
    await syncOnce(a, server.remote, { keys });
    await syncOnce(b, server.remote, { keys });
    const onB = listPipeline(b)[0]!;

    updatePipelineRow(a, row.id, { notes: 'from A (older)' }, TZ, T0);
    a.prepare("UPDATE sync_changes SET changed_at = '2099-01-01T09:00:00.000Z'").run();
    updatePipelineRow(b, onB.id, { notes: 'from B (newer)' }, TZ, T0);
    b.prepare("UPDATE sync_changes SET changed_at = '2099-01-01T10:00:00.000Z'").run();
    removeManualDeadline(a, id);

    await syncOnce(a, server.remote, { keys });
    await syncOnce(b, server.remote, { keys });
    await syncOnce(a, server.remote, { keys });

    expect(listPipeline(a)[0]!.notes).toBe('from B (newer)');
    expect(listPipeline(b)[0]!.notes).toBe('from B (newer)');
    expect(b.prepare('SELECT COUNT(*) FROM manual_deadlines').pluck().get()).toBe(0);
  });

  it('two devices that both edited a default template end with one copy, newest text', async () => {
    const keys = accountKeys();
    const server = fakeServer();
    const a = device();
    const b = device();
    const edit = (db: Database.Database, body: string, at: Date) => {
      const t = listTemplates(db).find((x) => x.name === 'Follow-up')!;
      saveTemplate(db, t.id, { name: t.name, kind: t.kind, subject: t.subject, body }, at);
    };
    edit(a, 'A text', T0);
    a.prepare("UPDATE sync_changes SET changed_at = '2099-01-01T08:00:00.000Z'").run();
    edit(b, 'B text (newer)', later(5));
    b.prepare("UPDATE sync_changes SET changed_at = '2099-01-01T08:05:00.000Z'").run();

    for (let i = 0; i < 3; i++) {
      await syncOnce(a, server.remote, { keys });
      await syncOnce(b, server.remote, { keys });
    }
    for (const db of [a, b]) {
      const t = listTemplates(db).filter((x) => x.name === 'Follow-up');
      expect(t).toHaveLength(1);
      expect(t[0]!.body).toBe('B text (newer)');
    }
    const uuids = (db: Database.Database) =>
      db.prepare("SELECT uuid FROM outreach_templates WHERE name = 'Follow-up'").pluck().get();
    expect(uuids(a)).toBe(uuids(b));
  });

  it('a record that does not decrypt, or sits under another row’s id, is reported and skipped', async () => {
    const keys = accountKeys();
    const server = fakeServer();
    const a = device();
    const b = device();
    createPipelineRow(a, { org: 'One' }, TZ, T0);
    createPipelineRow(a, { org: 'Two' }, TZ, T0);
    await syncOnce(a, server.remote, { keys });

    const [first, second] = [...server.rows.entries()];
    // The server moves one ciphertext onto the other id (AAD binds it), and the other key is wrong.
    server.rows.set(first![0], { ...first![1], ciphertext: second![1].ciphertext });
    const r = await syncOnce(b, server.remote, { keys: accountKeys() });
    expect(r.applied).toBe(0);
    expect(r.failed).toHaveLength(2);
    expect(r.failed[0]).toMatch(/does not decrypt/);
    expect(listPipeline(b)).toEqual([]);

    // With the right key, only the swapped record fails.
    b.prepare("DELETE FROM sync_state WHERE key = 'cursor'").run();
    const ok = await syncOnce(b, server.remote, { keys });
    expect(ok.failed).toHaveLength(1);
    expect(listPipeline(b)).toHaveLength(1);
  });

  it('ids are stable per row and differ per account', () => {
    const k1 = accountKeys();
    const k2 = accountKeys();
    expect(recordId(k1, 'pipeline', 'x')).toBe(recordId(k1, 'pipeline', 'x'));
    expect(recordId(k1, 'pipeline', 'x')).not.toBe(recordId(k2, 'pipeline', 'x'));
    expect(() =>
      unseal(k1, 'a'.repeat(64), Buffer.from([2, ...randomBytes(40)]).toString('base64')),
    ).toThrow(/newer/);
  });
});
