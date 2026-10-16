import type Database from 'better-sqlite3';
import {
  DEFAULT_SETTINGS,
  settingKeySchema,
  settingsSchema,
  type SettingKey,
  type Settings,
} from './schema';

const KEYS = settingKeySchema.options;

/** Inserts defaults for keys that have no row yet. Returns the keys that were seeded. */
export function seedDefaultSettings(db: Database.Database): SettingKey[] {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value_json) VALUES (?, ?)');
  return db.transaction(() =>
    KEYS.filter((key) => insert.run(key, JSON.stringify(DEFAULT_SETTINGS[key])).changes > 0),
  )();
}

function parseStored(key: SettingKey, valueJson: string): unknown {
  try {
    return JSON.parse(valueJson);
  } catch (err) {
    throw new Error(`Setting "${key}" holds invalid JSON`, { cause: err });
  }
}

export function getSetting<K extends SettingKey>(db: Database.Database, key: K): Settings[K] {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as
    { value_json: string } | undefined;
  if (!row) throw new Error(`Setting "${key}" is missing; were defaults seeded?`);
  return settingsSchema.shape[key].parse(parseStored(key, row.value_json)) as Settings[K];
}

/** All settings, validated as a whole. Rows for keys this version does not know are ignored. */
export function getAllSettings(db: Database.Database): Settings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as {
    key: string;
    value_json: string;
  }[];
  const raw: Record<string, unknown> = {};
  for (const { key, value_json } of rows) {
    const known = settingKeySchema.safeParse(key);
    if (known.success) raw[key] = parseStored(known.data, value_json);
  }
  return settingsSchema.parse(raw);
}

/** Validates and stores one setting. Throws a ZodError on invalid values; nothing is written. */
export function setSetting<K extends SettingKey>(
  db: Database.Database,
  key: K,
  value: unknown,
): Settings[K] {
  const parsed = settingsSchema.shape[settingKeySchema.parse(key)].parse(value) as Settings[K];
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
  ).run(key, JSON.stringify(parsed));
  return parsed;
}
