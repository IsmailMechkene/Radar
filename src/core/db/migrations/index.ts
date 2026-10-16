import { sql as init } from './001_init';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Append only. Never edit a migration that has shipped; add a new one instead.
export const migrations: readonly Migration[] = [{ version: 1, name: 'init', sql: init }];
