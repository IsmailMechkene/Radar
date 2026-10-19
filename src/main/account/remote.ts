// The account's encrypted store on Supabase (supabase/migrations/*_sync.sql): the vault (the data
// key wrapped by the recovery key) and the sync records. Everything sent here is already
// encrypted; row-level security limits each user to their own rows. No Electron imports.
import { recoveryPartSchema, type RecoveryPart } from '../../core/vault/keys';
import type { SyncRemote } from '../../core/sync/engine';
import { z } from 'zod';
import { AccountError, toAccountError, type RadarSupabase } from './service';

export interface AccountRemote extends SyncRemote {
  /** The account's recovery-wrapped data key, or null before any device synced. */
  getVault(): Promise<RecoveryPart | null>;
  /** Stores it unless the account has one already; returns the one the account keeps. */
  putVault(part: RecoveryPart): Promise<RecoveryPart>;
}

/** Network failures, ended sessions and server refusals, as the account screens explain them. */
export function toRemoteError(err: unknown): AccountError {
  if (err instanceof AccountError) return err;
  const e = err as { code?: string; message?: string } | null;
  const message = e?.message ?? String(err);
  if (err instanceof TypeError || /fetch failed|failed to fetch|network/i.test(message)) {
    return toAccountError(new TypeError('fetch failed'));
  }
  if (e?.code === 'PGRST301' || e?.code === 'PGRST303' || e?.code === '42501') {
    return new AccountError('session-expired', 'Your session ended. Sign in again.');
  }
  return new AccountError('other', `The account server refused the request: ${message}`);
}

const recordSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  seq: z.coerce.number().int().positive(),
  ciphertext: z.string(),
});

export function createSupabaseRemote(supabase: RadarSupabase): AccountRemote {
  /** Data requests need the session (renewed here if it expired and the network is up). */
  async function signedIn(): Promise<void> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toAccountError(error);
    if (!data.session) {
      throw new AccountError('session-expired', 'Your session ended. Sign in again.');
    }
  }

  async function run<T>(op: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
    await signedIn();
    let r: { data: T; error: unknown };
    try {
      r = await op();
    } catch (err) {
      throw toRemoteError(err);
    }
    if (r.error) throw toRemoteError(r.error);
    return r.data;
  }

  async function getVault(): Promise<RecoveryPart | null> {
    const row = await run(() => supabase.from('sync_vaults').select('recovery').maybeSingle());
    if (!row) return null;
    const parsed = recoveryPartSchema.safeParse((row as { recovery: unknown }).recovery);
    if (!parsed.success) {
      throw new AccountError('other', 'The account keeps a recovery key this Radar cannot read');
    }
    return parsed.data;
  }

  return {
    getVault,

    async putVault(part) {
      await signedIn();
      const { error } = await supabase.from('sync_vaults').insert({ recovery: part });
      // 23505: another device stored one first; the account keeps that one.
      if (error && (error as { code?: string }).code !== '23505') throw toRemoteError(error);
      const stored = await getVault();
      if (!stored) throw new AccountError('other', 'The account did not keep the recovery key');
      return stored;
    },

    async pull(after, limit) {
      const rows = await run(() =>
        supabase
          .from('sync_records')
          .select('id, seq, ciphertext')
          .gt('seq', after)
          .order('seq', { ascending: true })
          .limit(limit),
      );
      return z.array(recordSchema).parse(rows);
    },

    async push(records) {
      await run(() =>
        supabase.rpc('sync_push', {
          records: records.map((r) => ({
            id: r.id,
            updated_at: r.updatedAt,
            ciphertext: r.ciphertext,
          })),
        }),
      );
    },
  };
}
