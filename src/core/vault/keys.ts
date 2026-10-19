// The data key and its two wrappings (keys.json). A random 32-byte data key encrypts radar.db.
// It is stored only wrapped (AES-256-GCM): once with a key derived from the password (scrypt) and
// once with a key derived from the recovery key (HKDF; the recovery key is already random).
// Neither the password nor the recovery key is ever stored. No Electron: runs headless too.
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { passwordProblem } from '../../shared/password';

export { PASSWORD_MAX_BYTES, PASSWORD_MIN, passwordProblem } from '../../shared/password';

export const KEYS_FILE_NAME = 'keys.json';
export const DATA_KEY_BYTES = 32;
const RECOVERY_KEY_BYTES = 20; // 160 bits, 32 base32 characters

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}
/** About 0.3-0.5 s and 128 MB on a laptop: slow to guess, fast enough to unlock. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const b64 = z.string().regex(/^[A-Za-z0-9+/]+=*$/);
const wrappedSchema = z.strictObject({ iv: b64, tag: b64, data: b64 });
/** The online account this computer's data belongs to (Phase 2); absent before one is linked. */
const accountSchema = z.strictObject({
  userId: z.uuid(),
  email: z.email(),
  /** How the user signs in. Email users unlock with their account password; Google users with
   * a separate password chosen for this computer. */
  provider: z.enum(['email', 'google']),
  linkedAt: z.iso.datetime(),
});
export type LinkedAccount = z.output<typeof accountSchema>;

const keyFileSchema = z.strictObject({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  password: z.strictObject({
    kdf: z.literal('scrypt'),
    salt: b64,
    N: z.int().min(2 ** 10),
    r: z.int().min(1),
    p: z.int().min(1),
    wrapped: wrappedSchema,
  }),
  recovery: z.strictObject({
    kdf: z.literal('hkdf-sha256'),
    salt: b64,
    wrapped: wrappedSchema,
    /** When the user confirmed they saved this recovery key; null until then. */
    confirmedAt: z.iso.datetime().nullable(),
  }),
  account: accountSchema.optional(),
});
export type KeyFile = z.output<typeof keyFileSchema>;
type Wrapped = z.output<typeof wrappedSchema>;

/** Thrown when a password or recovery key does not open the data key. */
export class WrongSecretError extends Error {
  constructor(what: 'password' | 'recovery key') {
    super(what === 'password' ? 'Wrong password' : 'Wrong recovery key');
    this.name = 'WrongSecretError';
  }
}

export function keysPath(dataDir: string): string {
  return join(dataDir, KEYS_FILE_NAME);
}

function scrypt(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 256 * 1024 * 1024,
  };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFC'), salt, 32, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

function recoveryWrappingKey(recovery: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', recovery, salt, 'radar recovery key v1', 32));
}

// The wrapping says what it is for (AAD), so a password wrapping cannot pass as a recovery one.
function wrap(kek: Buffer, dataKey: Buffer, aad: string): Wrapped {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function unwrap(kek: Buffer, w: Wrapped, aad: string): Buffer | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(w.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(w.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(w.data, 'base64')), decipher.final()]);
    return key.length === DATA_KEY_BYTES ? key : null;
  } catch {
    return null; // authentication failed: wrong secret (or a damaged file)
  }
}

// Crockford base32: no I, L, O or U, so a key read aloud or retyped is not misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** "7K2M-…" : 32 characters in groups of 4. */
export function formatRecoveryKey(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Reads a typed recovery key (any case, spaces or dashes, O for 0, I/L for 1); null if invalid. */
export function parseRecoveryKey(text: string): Buffer | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== Math.ceil((RECOVERY_KEY_BYTES * 8) / 5)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out.slice(0, RECOVERY_KEY_BYTES));
}

async function passwordPart(dataKey: Buffer, password: string, params: ScryptParams) {
  const salt = randomBytes(16);
  const kek = await scrypt(password, salt, params);
  return {
    kdf: 'scrypt' as const,
    salt: salt.toString('base64'),
    ...params,
    wrapped: wrap(kek, dataKey, 'radar:password'),
  };
}

function recoveryPart(dataKey: Buffer): { part: KeyFile['recovery']; recoveryKey: string } {
  const recovery = randomBytes(RECOVERY_KEY_BYTES);
  const salt = randomBytes(16);
  return {
    part: {
      kdf: 'hkdf-sha256',
      salt: salt.toString('base64'),
      wrapped: wrap(recoveryWrappingKey(recovery, salt), dataKey, 'radar:recovery'),
      confirmedAt: null,
    },
    recoveryKey: formatRecoveryKey(recovery),
  };
}

export interface NewKeys {
  file: KeyFile;
  dataKey: Buffer;
  /** Shown once; never stored. */
  recoveryKey: string;
}

/** A new data key, wrapped by the password and by a new recovery key. */
export async function createKeys(
  password: string,
  now: Date,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<NewKeys> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const { part, recoveryKey } = recoveryPart(dataKey);
  const file: KeyFile = {
    version: 1,
    createdAt: now.toISOString(),
    password: await passwordPart(dataKey, password, params),
    recovery: part,
  };
  return { file, dataKey, recoveryKey };
}

export async function unlockWithPassword(file: KeyFile, password: string): Promise<Buffer> {
  const p = file.password;
  const kek = await scrypt(password, Buffer.from(p.salt, 'base64'), p);
  const key = unwrap(kek, p.wrapped, 'radar:password');
  if (!key) throw new WrongSecretError('password');
  return key;
}

export function unlockWithRecoveryKey(file: KeyFile, recoveryKey: string): Buffer {
  const bytes = parseRecoveryKey(recoveryKey);
  if (!bytes) throw new WrongSecretError('recovery key');
  const r = file.recovery;
  const key = unwrap(
    recoveryWrappingKey(bytes, Buffer.from(r.salt, 'base64')),
    r.wrapped,
    'radar:recovery',
  );
  if (!key) throw new WrongSecretError('recovery key');
  return key;
}

/** The same data key under a new password (after a reset); the recovery wrapping is kept. */
export async function rewrapPassword(
  file: KeyFile,
  dataKey: Buffer,
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<KeyFile> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return { ...file, password: await passwordPart(dataKey, password, params) };
}

/** A new recovery key for the same data key; the old one stops working. */
export function reissueRecoveryKey(
  file: KeyFile,
  dataKey: Buffer,
): { file: KeyFile; recoveryKey: string } {
  const { part, recoveryKey } = recoveryPart(dataKey);
  return { file: { ...file, recovery: part }, recoveryKey };
}

/** Records the account the data belongs to; another account can then not open it. */
export function linkAccount(
  file: KeyFile,
  account: Omit<LinkedAccount, 'linkedAt'>,
  now: Date,
): KeyFile {
  return { ...file, account: { ...account, linkedAt: now.toISOString() } };
}

export function confirmRecoveryKey(file: KeyFile, now: Date): KeyFile {
  return { ...file, recovery: { ...file.recovery, confirmedAt: now.toISOString() } };
}

/** keys.json, validated; null when there is none. A damaged file throws (never overwritten). */
export function readKeyFile(dataDir: string): KeyFile | null {
  const path = keysPath(dataDir);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`${path} is not valid JSON`, { cause: err });
  }
  const parsed = keyFileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${path} is damaged: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Written to a temporary file first, so a crash never leaves a half-written keys.json. */
export function writeKeyFile(dataDir: string, file: KeyFile): void {
  const path = keysPath(dataDir);
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(keyFileSchema.parse(file), null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}
