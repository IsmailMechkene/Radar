import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupDatabase } from '../src/core/backup';
import { migrate } from '../src/core/db/migrate';
import { isPlainDatabase, openDatabase, resolveDbPath, WrongKeyError } from '../src/core/db/open';
import { getSetting, seedDefaultSettings, setSetting } from '../src/core/settings/store';
import { prepareEncryptedDatabase, tableFingerprints } from '../src/core/vault/encrypt';
import {
  confirmRecoveryKey,
  createKeys,
  formatRecoveryKey,
  keysPath,
  parseRecoveryKey,
  passwordProblem,
  readKeyFile,
  reissueRecoveryKey,
  rewrapPassword,
  unlockWithPassword,
  unlockWithRecoveryKey,
  writeKeyFile,
  WrongSecretError,
  type ScryptParams,
} from '../src/core/vault/keys';
import { createVault } from '../src/main/vault';
import type { AuthStatus } from '../src/shared/ipc';

// Real scrypt costs ~0.5 s per call; tests use a cheap setting (the format is the same).
const FAST: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };
const NOW = new Date('2026-10-19T09:00:00.000Z');
const PASSWORD = 'correct horse battery';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-vault-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A plain database like the ones Radar wrote before encryption, with a few user rows. */
function plainDatabaseWithData(dataDir: string): void {
  const db = openDatabase(resolveDbPath(dataDir));
  migrate(db);
  seedDefaultSettings(db);
  setSetting(db, 'timezone', 'Europe/Paris');
  db.prepare(
    "INSERT INTO pipeline (org, status, updated_at) VALUES ('Weaviate', 'drafted', ?)",
  ).run(NOW.toISOString());
  db.close();
}

describe('key file', () => {
  it('unwraps the same data key with the password and with the recovery key', async () => {
    const k = await createKeys(PASSWORD, NOW, FAST);
    expect(k.dataKey).toHaveLength(32);
    expect(await unlockWithPassword(k.file, PASSWORD)).toEqual(k.dataKey);
    expect(unlockWithRecoveryKey(k.file, k.recoveryKey)).toEqual(k.dataKey);
    expect(k.file.recovery.confirmedAt).toBeNull();
    // Nothing secret is stored in clear.
    const json = JSON.stringify(k.file);
    expect(json).not.toContain(PASSWORD);
    expect(json).not.toContain(k.recoveryKey.replace(/-/g, ''));
    expect(json).not.toContain(k.dataKey.toString('base64'));
  });

  it('refuses a wrong password or recovery key', async () => {
    const k = await createKeys(PASSWORD, NOW, FAST);
    await expect(unlockWithPassword(k.file, 'correct horse battery!')).rejects.toBeInstanceOf(
      WrongSecretError,
    );
    const other = await createKeys(PASSWORD, NOW, FAST);
    expect(() => unlockWithRecoveryKey(k.file, other.recoveryKey)).toThrow(WrongSecretError);
    expect(() => unlockWithRecoveryKey(k.file, 'not a key')).toThrow(WrongSecretError);
  });

  it('a password wrapping cannot be used as the recovery wrapping', async () => {
    const k = await createKeys(PASSWORD, NOW, FAST);
    const swapped = {
      ...k.file,
      recovery: { ...k.file.recovery, wrapped: k.file.password.wrapped },
    };
    expect(() => unlockWithRecoveryKey(swapped, k.recoveryKey)).toThrow(WrongSecretError);
  });

  it('formats recovery keys in groups and reads them back despite typos in case and spacing', () => {
    const bytes = Buffer.from('00112233445566778899aabbccddeeff01234567', 'hex');
    const text = formatRecoveryKey(bytes);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseRecoveryKey(text)).toEqual(bytes);
    expect(parseRecoveryKey(` ${text.toLowerCase().replace(/-/g, ' ')} `)).toEqual(bytes);
    // Crockford: O reads as 0, I and L as 1.
    expect(parseRecoveryKey(text.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(bytes);
    expect(parseRecoveryKey(text.slice(0, -1))).toBeNull();
    expect(parseRecoveryKey(`${text.slice(0, -1)}U`)).toBeNull();
  });

  it('checks passwords: at least 8 characters, at most 72 bytes', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('é'.repeat(37))).toMatch(/at most 72 bytes/);
    expect(passwordProblem(PASSWORD)).toBeNull();
  });

  it('re-wraps for a new password and re-issues the recovery key', async () => {
    const k = await createKeys(PASSWORD, NOW, FAST);
    const rewrapped = await rewrapPassword(k.file, k.dataKey, 'a whole new password', FAST);
    await expect(unlockWithPassword(rewrapped, PASSWORD)).rejects.toThrow(WrongSecretError);
    expect(await unlockWithPassword(rewrapped, 'a whole new password')).toEqual(k.dataKey);
    expect(unlockWithRecoveryKey(rewrapped, k.recoveryKey)).toEqual(k.dataKey);

    const r = reissueRecoveryKey(rewrapped, k.dataKey);
    expect(() => unlockWithRecoveryKey(r.file, k.recoveryKey)).toThrow(WrongSecretError);
    expect(unlockWithRecoveryKey(r.file, r.recoveryKey)).toEqual(k.dataKey);
    expect(confirmRecoveryKey(r.file, NOW).recovery.confirmedAt).toBe(NOW.toISOString());
  });

  it('round-trips keys.json and reports a damaged file instead of replacing it', async () => {
    expect(readKeyFile(dir)).toBeNull();
    const k = await createKeys(PASSWORD, NOW, FAST);
    writeKeyFile(dir, k.file);
    expect(readKeyFile(dir)).toEqual(k.file);
    expect(existsSync(`${keysPath(dir)}.tmp`)).toBe(false);
    writeFileSync(keysPath(dir), '{"version":1}');
    expect(() => readKeyFile(dir)).toThrow(/damaged/);
  });
});

describe('encrypted database', () => {
  it('cannot be read without the key, or with another key', async () => {
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    const path = resolveDbPath(dir);
    const db = openDatabase(path, dataKey);
    migrate(db);
    db.close();
    expect(isPlainDatabase(path)).toBe(false);
    expect(readFileSync(path).includes(Buffer.from('CREATE TABLE'))).toBe(false);
    const other = await createKeys(PASSWORD, NOW, FAST);
    expect(() => openDatabase(path, other.dataKey)).toThrow(WrongKeyError);
    const bare = new Database(path);
    expect(() => bare.prepare('SELECT * FROM sqlite_master').all()).toThrow(/not a database/);
    bare.close();
    const again = openDatabase(path, dataKey);
    expect(again.pragma('journal_mode', { simple: true })).toBe('wal');
    again.close();
  });

  it('backups are encrypted with the same key and restore the same data', async () => {
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    const db = openDatabase(resolveDbPath(dir), dataKey);
    migrate(db);
    seedDefaultSettings(db);
    setSetting(db, 'timezone', 'Asia/Tokyo');
    const r = await backupDatabase(db, join(dir, 'Backups'), NOW, 'UTC');
    db.close();
    expect(isPlainDatabase(r.file)).toBe(false);
    const copy = openDatabase(r.file, dataKey);
    expect(getSetting(copy, 'timezone')).toBe('Asia/Tokyo');
    copy.close();
  });
});

describe('prepareEncryptedDatabase (plain radar.db -> encrypted)', () => {
  it('encrypts a plain database in place, keeping every row, and deletes the plain file', async () => {
    plainDatabaseWithData(dir);
    const path = resolveDbPath(dir);
    const plain = new Database(path, { readonly: true });
    const before = tableFingerprints(plain);
    plain.close();

    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    expect(await prepareEncryptedDatabase(dir, dataKey)).toEqual({
      encrypted: true,
      cleanedUp: false,
    });
    expect(isPlainDatabase(path)).toBe(false);
    for (const leftover of ['.plain', '.encrypting', '-wal']) {
      expect(existsSync(path + leftover), leftover).toBe(false);
    }
    const db = openDatabase(path, dataKey);
    expect(tableFingerprints(db)).toEqual(before);
    expect(getSetting(db, 'timezone')).toBe('Europe/Paris');
    db.close();

    // Already encrypted: nothing to do.
    expect(await prepareEncryptedDatabase(dir, dataKey)).toEqual({
      encrypted: false,
      cleanedUp: false,
    });
  });

  it('does nothing when there is no database yet', async () => {
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    expect(await prepareEncryptedDatabase(dir, dataKey)).toEqual({
      encrypted: false,
      cleanedUp: false,
    });
    expect(existsSync(resolveDbPath(dir))).toBe(false);
  });

  it('resumes after a crash between the two renames (only the plain copy exists)', async () => {
    plainDatabaseWithData(dir);
    const path = resolveDbPath(dir);
    renameSync(path, `${path}.plain`);
    writeFileSync(`${path}.encrypting`, 'half-written');
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    expect((await prepareEncryptedDatabase(dir, dataKey)).encrypted).toBe(true);
    const db = openDatabase(path, dataKey);
    expect(getSetting(db, 'timezone')).toBe('Europe/Paris');
    db.close();
    expect(existsSync(`${path}.plain`)).toBe(false);
    expect(existsSync(`${path}.encrypting`)).toBe(false);
  });

  it('finishes after a crash past the swap (deletes the plain copy once the new file opens)', async () => {
    plainDatabaseWithData(dir);
    const path = resolveDbPath(dir);
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    await prepareEncryptedDatabase(dir, dataKey);
    mkdirSync(join(dir, 'old'));
    plainDatabaseWithData(join(dir, 'old'));
    renameSync(resolveDbPath(join(dir, 'old')), `${path}.plain`);
    expect(await prepareEncryptedDatabase(dir, dataKey)).toEqual({
      encrypted: false,
      cleanedUp: true,
    });
    expect(existsSync(`${path}.plain`)).toBe(false);
  });

  it('keeps the plain copy when the encrypted file does not open with the key', async () => {
    plainDatabaseWithData(dir);
    const path = resolveDbPath(dir);
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    await prepareEncryptedDatabase(dir, dataKey);
    writeFileSync(`${path}.plain`, 'the only other copy');
    const other = await createKeys(PASSWORD, NOW, FAST);
    await expect(prepareEncryptedDatabase(dir, other.dataKey)).rejects.toThrow(WrongKeyError);
    expect(readFileSync(`${path}.plain`, 'utf8')).toBe('the only other copy');
  });

  it('leaves the plain file untouched when the copy cannot be made', async () => {
    plainDatabaseWithData(dir);
    const path = resolveDbPath(dir);
    const original = readFileSync(path);
    const { dataKey } = await createKeys(PASSWORD, NOW, FAST);
    const backup = vi
      .spyOn(Database.prototype, 'backup')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(prepareEncryptedDatabase(dir, dataKey)).rejects.toThrow(
      /your data was not changed/,
    );
    backup.mockRestore();
    expect(readFileSync(path)).toEqual(original);
    expect(existsSync(`${path}.encrypting`)).toBe(false);
  });
});

describe('vault (lock state in main)', () => {
  function setup() {
    const opened: Buffer[] = [];
    const events: AuthStatus['state'][] = [];
    let closes = 0;
    let openError: Error | null = null;
    const vault = createVault({
      dataDir: dir,
      now: () => NOW,
      scrypt: FAST,
      open: async (key) => {
        if (openError) throw openError;
        // What main does: encrypt a plain file, then open it with the key.
        await prepareEncryptedDatabase(dir, key);
        openDatabase(resolveDbPath(dir), key).close();
        opened.push(Buffer.from(key));
      },
      close: async () => void (closes += 1),
      onChange: (s) => events.push(s.state),
    });
    return {
      vault,
      opened,
      events,
      closes: () => closes,
      failOpen: (e: Error | null) => (openError = e),
    };
  }

  it('first run: setup encrypts existing data and shows the recovery key until confirmed', async () => {
    plainDatabaseWithData(dir);
    const { vault, opened } = setup();
    expect(vault.status()).toEqual({ state: 'setup', hasPlainData: true });
    await expect(vault.setup('short')).rejects.toThrow(/at least 8/);
    const s = await vault.setup(PASSWORD);
    expect(s.state).toBe('unlocked');
    const recoveryKey = s.state === 'unlocked' ? s.recoveryKey : null;
    expect(recoveryKey).toMatch(/^(\w{4}-){7}\w{4}$/);
    expect(isPlainDatabase(resolveDbPath(dir))).toBe(false);
    expect(opened).toHaveLength(1);
    expect(await vault.confirmRecoveryKey()).toEqual({ state: 'unlocked', recoveryKey: null });
    expect(readKeyFile(dir)!.recovery.confirmedAt).toBe(NOW.toISOString());
    // The recovery key from setup still opens the data.
    expect(unlockWithRecoveryKey(readKeyFile(dir)!, recoveryKey!)).toEqual(opened[0]);
    await expect(vault.setup(PASSWORD)).rejects.toThrow(/already has a password/);
  });

  it('lock wipes the key, closes, and unlock needs the right password', async () => {
    const { vault, opened, events, closes } = setup();
    await vault.setup(PASSWORD);
    await vault.confirmRecoveryKey();
    expect(await vault.lock()).toEqual({ state: 'locked' });
    expect(closes()).toBe(1);
    expect(vault.isUnlocked()).toBe(false);
    await expect(vault.unlock('wrong password')).rejects.toThrow(/Wrong password/);
    expect(await vault.unlock(PASSWORD)).toEqual({ state: 'unlocked', recoveryKey: null });
    expect(opened[1]).toEqual(opened[0]);
    expect(events).toEqual(['unlocked', 'unlocked', 'locked', 'unlocked']);
  });

  it('issues a new recovery key at unlock when the first one was never confirmed', async () => {
    const { vault } = setup();
    const first = await vault.setup(PASSWORD);
    await vault.lock(); // e.g. the app quit before "I saved it"
    const s = await vault.unlock(PASSWORD);
    const firstKey = first.state === 'unlocked' ? first.recoveryKey : null;
    const nextKey = s.state === 'unlocked' ? s.recoveryKey : null;
    expect(nextKey).toBeTruthy();
    expect(nextKey).not.toBe(firstKey);
    expect(() => unlockWithRecoveryKey(readKeyFile(dir)!, firstKey!)).toThrow(WrongSecretError);
  });

  it('forgot password: the recovery key opens the data and sets a new password', async () => {
    const { vault, opened } = setup();
    const first = await vault.setup(PASSWORD);
    const recoveryKey = first.state === 'unlocked' ? first.recoveryKey! : '';
    await vault.lock();
    await expect(vault.recover('AAAA-AAAA', 'new password here')).rejects.toThrow(
      /Wrong recovery key/,
    );
    expect(await vault.recover(recoveryKey.toLowerCase(), 'new password here')).toEqual({
      state: 'unlocked',
      recoveryKey: null,
    });
    expect(opened[1]).toEqual(opened[0]);
    await vault.lock();
    await expect(vault.unlock(PASSWORD)).rejects.toThrow(/Wrong password/);
    expect((await vault.unlock('new password here')).state).toBe('unlocked');
  });

  it('a failed open leaves the vault locked and wipes nothing on disk', async () => {
    const { vault, failOpen } = setup();
    await vault.setup(PASSWORD);
    await vault.lock();
    failOpen(new Error('migration failed'));
    await expect(vault.unlock(PASSWORD)).rejects.toThrow(/migration failed/);
    expect(vault.status().state).toBe('locked');
    failOpen(null);
    expect((await vault.unlock(PASSWORD)).state).toBe('unlocked');
  });

  it('refuses to start over when the database is encrypted but keys.json is gone', async () => {
    const { vault } = setup();
    await vault.setup(PASSWORD);
    await vault.lock();
    expect(isPlainDatabase(resolveDbPath(dir))).toBe(false); // setup created an encrypted file
    rmSync(keysPath(dir));
    expect(vault.status()).toMatchObject({ state: 'error' });
    await expect(vault.setup(PASSWORD)).rejects.toThrow(/already has a password/);
  });

  it('runs one operation at a time', async () => {
    const { vault, opened } = setup();
    await vault.setup(PASSWORD);
    await vault.lock();
    const [a, b] = await Promise.all([vault.unlock(PASSWORD), vault.unlock(PASSWORD)]);
    expect(a.state).toBe('unlocked');
    expect(b.state).toBe('unlocked');
    expect(opened).toHaveLength(2); // setup + one unlock
  });
});
