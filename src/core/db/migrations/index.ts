import { sql as init } from './001_init';
import { sql as opportunityState } from './002_opportunity_state';
import { sql as sourceIdentity } from './003_source_identity';
import { sql as deadlinesReminders } from './004_deadlines_reminders';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Append only. Never edit a migration that has shipped; add a new one instead.
export const migrations: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'opportunity_state', sql: opportunityState },
  { version: 3, name: 'source_identity', sql: sourceIdentity },
  { version: 4, name: 'deadlines_reminders', sql: deadlinesReminders },
];
