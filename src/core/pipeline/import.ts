// One-time import of the outreach tracker sheet (SPEC section 10), exported as CSV. Headers are
// matched by name in English or French, in any order; unknown columns are ignored and listed.
// Rows already in the pipeline (same organization and role) are skipped, so a re-import is safe.
// Nothing is silently dropped: every skipped row or unread value is reported.
import type Database from 'better-sqlite3-multiple-ciphers';
import { createPipelineRow, type PipelineNew, type PipelineStatus } from '../db/pipeline';
import { readDate } from '../deadlines/parse';
import { zonedToUtc } from '../time';
import { parseCsv } from './csv';

type Field =
  | 'org'
  | 'role'
  | 'status'
  | 'planned_send_date'
  | 'sent_at'
  | 'contact_name'
  | 'contact_url'
  | 'notes';

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();

/** Accepted header names per field, already folded. */
// prettier-ignore
const HEADERS: Record<Field, readonly string[]> = {
  org: ['organization', 'organisation', 'org', 'company', 'entreprise', 'organisme', 'societe'],
  role: ['role', 'position', 'poste', 'title', 'job', 'job title', 'opportunity', 'program', 'programme', 'offer'],
  status: ['status', 'statut', 'state', 'etat'],
  planned_send_date: ['planned send date', 'planned', 'planned date', 'planned send', 'send date', 'date to send', 'first send', 'planned first send', 'date prevue', 'date', 'send on'],
  sent_at: ['sent', 'sent date', 'sent on', 'date sent', 'sent at', 'envoye', 'envoye le', 'date d envoi', 'date envoi'],
  contact_name: ['contact', 'contact name', 'person', 'recruiter', 'interlocuteur'],
  contact_url: ['email', 'e mail', 'mail', 'contact email', 'contact url', 'link', 'url', 'linkedin', 'lien', 'website', 'contact link'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'remarques', 'commentaires'],
};

// prettier-ignore
const STATUS_WORDS: Record<PipelineStatus, readonly string[]> = {
  not_started: ['not started', 'to do', 'todo', 'to send', 'planned', 'pending', 'pas commence', 'a faire', 'a envoyer', 'prevu'],
  drafted: ['drafted', 'draft', 'draft ready', 'brouillon', 'redige'],
  sent: ['sent', 'emailed', 'applied', 'submitted', 'envoye', 'postule', 'candidature envoyee'],
  followup_sent: ['follow up sent', 'followup sent', 'followed up', 'follow up', 'relance', 'relance envoyee', 'relance faite'],
  interview: ['interview', 'interviewing', 'entretien', 'entretiens'],
  rejected: ['rejected', 'refused', 'declined', 'refus', 'refuse', 'refusee'],
  offer: ['offer', 'offre', 'accepted', 'accepte'],
  not_eligible: ['not eligible', 'ineligible', 'non eligible', 'pas eligible'],
};

export function statusFromText(text: string): PipelineStatus | null {
  const t = fold(text);
  for (const [status, words] of Object.entries(STATUS_WORDS) as [
    PipelineStatus,
    readonly string[],
  ][]) {
    if (words.includes(t)) return status;
  }
  return null;
}

export interface ImportResult {
  added: number;
  /** Rows already in the pipeline (same organization and role). */
  skipped: number;
  /** "Organization ← Company" for every mapped column. */
  columns: string[];
  /** Header names that matched nothing. */
  ignoredColumns: string[];
  /** Per-row problems: rows not imported, values that could not be read. */
  problems: string[];
}

/** Maps header cells to fields; the first column wins when two match the same field. */
export function mapHeaders(header: readonly string[]): {
  map: Partial<Record<Field, number>>;
  ignored: string[];
} {
  const map: Partial<Record<Field, number>> = {};
  const ignored: string[] = [];
  header.forEach((cell, i) => {
    const h = fold(cell);
    const field = (Object.keys(HEADERS) as Field[]).find((f) => HEADERS[f].includes(h));
    if (field && map[field] === undefined) map[field] = i;
    else if (cell.trim()) ignored.push(cell.trim());
  });
  return { map, ignored };
}

const FIELD_LABEL: Record<Field, string> = {
  org: 'Organization',
  role: 'Role',
  status: 'Status',
  planned_send_date: 'Planned send date',
  sent_at: 'Sent',
  contact_name: 'Contact',
  contact_url: 'Contact link or email',
  notes: 'Notes',
};

/** Links a row to a watched program when the organization names it (first word, 4+ letters). */
function programFor(db: Database.Database, org: string): number | null {
  const programs = db.prepare('SELECT id, name, org FROM programs').all() as {
    id: number;
    name: string;
    org: string | null;
  }[];
  const o = fold(org);
  const exact = programs.find((p) => fold(p.name) === o || (p.org && fold(p.org) === o));
  if (exact) return exact.id;
  const first = o.split(' ')[0] ?? '';
  if (first.length < 4) return null;
  const hits = programs.filter((p) => fold(p.name).split(' ')[0] === first);
  return hits.length === 1 ? hits[0]!.id : null;
}

export function importPipelineCsv(
  db: Database.Database,
  csv: string,
  timeZone: string,
  now: Date,
): ImportResult {
  const { rows, problems: fileProblems } = parseCsv(csv);
  const [header, ...body] = rows;
  if (!header) throw new Error('The file is empty.');
  const { map, ignored } = mapHeaders(header);
  if (map.org === undefined) {
    throw new Error(
      `No organization column. The first row must name the columns; accepted for the organization: ${HEADERS.org.join(', ')}. Found: ${header.map((h) => `"${h}"`).join(', ')}.`,
    );
  }
  const result: ImportResult = {
    added: 0,
    skipped: 0,
    columns: (Object.entries(map) as [Field, number][]).map(
      ([f, i]) => `${FIELD_LABEL[f]} ← ${header[i]!.trim()}`,
    ),
    ignoredColumns: ignored,
    problems: [...fileProblems],
  };
  const exists = db.prepare(
    `SELECT 1 FROM pipeline WHERE lower(org) = lower(?) AND lower(COALESCE(role, '')) = lower(?)`,
  );
  const ctx = { reference: now, timeZone, language: 'fr' as const }; // sheets in a FR/TN locale: day-first

  db.transaction(() => {
    body.forEach((cells, index) => {
      const line = index + 2; // 1-based, after the header
      const cell = (f: Field) => (map[f] === undefined ? '' : (cells[map[f]] ?? '').trim());
      const org = cell('org');
      if (!org) {
        result.problems.push(`Line ${line}: no organization, row not imported.`);
        return;
      }
      const role = cell('role');
      if (exists.get(org, role)) {
        result.skipped += 1;
        return;
      }
      const row: PipelineNew = {
        org,
        role,
        contact_name: cell('contact_name'),
        contact_url: cell('contact_url'),
        notes: cell('notes'),
      };
      const date = (f: 'planned_send_date' | 'sent_at') => {
        const raw = cell(f);
        if (!raw || raw === '-' || raw === '—') return null;
        const d = readDate(raw, ctx);
        if (!d) {
          result.problems.push(
            `Line ${line} (${org}): ${FIELD_LABEL[f].toLowerCase()} "${raw}" not understood, left empty.`,
          );
          return null;
        }
        return d.date;
      };
      row.planned_send_date = date('planned_send_date');
      const sent = date('sent_at');
      if (sent) {
        const [y, m, d] = sent.split('-').map(Number) as [number, number, number];
        row.sent_at = zonedToUtc(y, m, d, 12, 0, 0, 0, timeZone).toISOString(); // midday: no day shift
      }
      const statusText = cell('status');
      const status = statusText ? statusFromText(statusText) : null;
      if (statusText && !status) {
        result.problems.push(
          `Line ${line} (${org}): status "${statusText}" not recognized, imported as ${sent ? 'Sent' : 'Not started'}.`,
        );
      }
      row.status = status ?? (sent ? 'sent' : 'not_started');
      const created = createPipelineRow(db, row, timeZone, now);
      const programId = programFor(db, org);
      if (programId !== null) {
        db.prepare('UPDATE pipeline SET program_id = ? WHERE id = ?').run(programId, created.id);
      }
      result.added += 1;
    });
  })();
  return result;
}
