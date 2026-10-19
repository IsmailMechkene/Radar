// End-to-end encryption of synced rows. Everything derives from the account's sync root, itself
// derived from the account's data key (HKDF), so the server never holds a key: it sees opaque
// record ids (HMAC) and AES-256-GCM ciphertext. The record id is bound into each ciphertext (AAD),
// so the server cannot move a record onto another row. No Electron: runs headless too.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const derive = (key: Buffer, info: string) =>
  Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), info, 32));

/** The account's sync secret, from its data key. Kept on each device inside the encrypted DB. */
export function syncRoot(dataKey: Buffer): Buffer {
  return derive(dataKey, 'radar sync root v1');
}

export interface SyncKeys {
  /** Encrypts row payloads. */
  enc: Buffer;
  /** Turns (entity, key) into an id the server cannot read. */
  id: Buffer;
}

export function syncKeys(root: Buffer): SyncKeys {
  return { enc: derive(root, 'radar sync encrypt v1'), id: derive(root, 'radar sync id v1') };
}

export function recordId(keys: SyncKeys, entity: string, key: string): string {
  return createHmac('sha256', keys.id).update(`${entity}\0${key}`).digest('hex');
}

/** Thrown when a record does not decrypt (another key, tampering, or a newer format). */
export class SyncCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncCryptoError';
  }
}

const aad = (id: string) => Buffer.from(`radar sync:${id}`);

/** base64(format byte | iv | tag | ciphertext). */
export function seal(keys: SyncKeys, id: string, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keys.enc, iv);
  cipher.setAAD(aad(id));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), data]).toString('base64');
}

export function unseal(keys: SyncKeys, id: string, sealed: string): string {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 1 + IV_BYTES + TAG_BYTES) throw new SyncCryptoError('Record is too short');
  if (raw[0] !== FORMAT) {
    throw new SyncCryptoError(`Record format ${raw[0]} is newer than this Radar; update Radar`);
  }
  const iv = raw.subarray(1, 1 + IV_BYTES);
  const tag = raw.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keys.enc, iv);
    decipher.setAAD(aad(id));
    decipher.setAuthTag(tag);
    const data = raw.subarray(1 + IV_BYTES + TAG_BYTES);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new SyncCryptoError('Record does not decrypt with this account key');
  }
}
