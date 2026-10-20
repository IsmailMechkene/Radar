import { sql as init } from './001_init';
import { sql as opportunityState } from './002_opportunity_state';
import { sql as sourceIdentity } from './003_source_identity';
import { sql as deadlinesReminders } from './004_deadlines_reminders';
import { sql as pipelineRole } from './005_pipeline_role';
import { sql as manualDeadlines } from './006_manual_deadlines';
import { sql as programEdits } from './007_program_edits';
import { sql as sourceControls } from './008_source_controls';
import { sql as outreach } from './009_outreach';
import { sql as userRules } from './010_user_rules';
import { sql as matchAlerts } from './011_match_alerts';
import { sql as sync } from './012_sync';
import { sql as refreshRevision } from './013_refresh_revision';
import { sql as listSummary } from './014_list_summary';

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
  { version: 5, name: 'pipeline_role', sql: pipelineRole },
  { version: 6, name: 'manual_deadlines', sql: manualDeadlines },
  { version: 7, name: 'program_edits', sql: programEdits },
  { version: 8, name: 'source_controls', sql: sourceControls },
  { version: 9, name: 'outreach', sql: outreach },
  { version: 10, name: 'user_rules', sql: userRules },
  { version: 11, name: 'match_alerts', sql: matchAlerts },
  { version: 12, name: 'sync', sql: sync },
  { version: 13, name: 'refresh_revision', sql: refreshRevision },
  { version: 14, name: 'list_summary', sql: listSummary },
];
