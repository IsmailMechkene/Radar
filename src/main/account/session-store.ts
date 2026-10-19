// Where the Supabase session (access and refresh tokens) lives: in main only, never sent to the
// page, and on disk only encrypted by the OS (Electron safeStorage: DPAPI on Windows, Keychain on
// macOS). No Electron imports: encryption is injected, which keeps this testable.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface Codec {
  /** False when the OS offers no secure storage: the session then lives in memory only. */
  available: () => boolean;
  encrypt: (plain: string) => Buffer;
  decrypt: (data: Buffer) => string;
}

/** The storage interface supabase-js expects (synchronous variant). */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** True when a signed-in session is stored (it may have expired; only the server can tell). */
  has(key: string): boolean;
  clear(): void;
}

export function createSessionStore(file: string, codec: Codec): SessionStore {
  let items: Record<string, string> = {};
  if (codec.available() && existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(codec.decrypt(readFileSync(file)));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        items = Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        );
      }
    } catch (err) {
      // Unreadable (another Windows user, a damaged file): signing in again replaces it.
      console.error('[account] stored session could not be read; sign in again:', err);
      items = {};
    }
  }

  function persist(): void {
    if (!codec.available()) {
      console.warn('[account] no secure storage on this system; the session is kept in memory');
      return;
    }
    if (Object.keys(items).length === 0) {
      rmSync(file, { force: true });
      return;
    }
    const temp = `${file}.tmp`;
    writeFileSync(temp, codec.encrypt(JSON.stringify(items)), { mode: 0o600 });
    renameSync(temp, file);
  }

  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value;
      persist();
    },
    removeItem: (key) => {
      delete items[key];
      persist();
    },
    has: (key) => key in items,
    clear: () => {
      items = {};
      persist();
    },
  };
}
