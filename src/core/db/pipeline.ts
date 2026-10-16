import type Database from 'better-sqlite3';

export interface AddToPipelineResult {
  /** New pipeline row ids (for Undo). */
  added: number[];
  /** Opportunities that were already in the pipeline. */
  skipped: number;
}

/** Adds opportunities to the pipeline as "Not started". Opportunities already there are skipped. */
export function addOpportunitiesToPipeline(
  db: Database.Database,
  opportunityIds: readonly number[],
  now: Date,
): AddToPipelineResult {
  const exists = db.prepare('SELECT 1 FROM pipeline WHERE opportunity_id = ?');
  const org = db.prepare('SELECT org FROM opportunities WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO pipeline (opportunity_id, org, status, updated_at)
     VALUES (?, ?, 'not_started', ?) RETURNING id`,
  );
  return db.transaction((): AddToPipelineResult => {
    const added: number[] = [];
    let skipped = 0;
    for (const id of new Set(opportunityIds)) {
      if (exists.get(id)) {
        skipped += 1;
        continue;
      }
      const row = org.get(id) as { org: string } | undefined;
      if (!row) throw new Error(`No opportunity with id ${id}`);
      const { id: pipelineId } = insert.get(id, row.org, now.toISOString()) as { id: number };
      added.push(pipelineId);
    }
    return { added, skipped };
  })();
}

/** Deletes pipeline rows by id (Undo of an add). Returns how many were removed. */
export function removePipelineRows(db: Database.Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  return db
    .prepare(`DELETE FROM pipeline WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .run(...ids).changes;
}
