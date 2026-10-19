import { KeyRound, LogOut, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AuthStatus, SyncStatus } from '../../../shared/ipc';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { GroupedRow, GroupedSection } from '../../components/GroupedList';
import { TextInput } from '../../components/Input';
import { useToast } from '../../components/Toast';
import { sessionLabel } from '../lib/lock';
import { cleanIpcError } from '../lib/settings-helpers';
import { syncLabel } from '../lib/sync';

/** Sync status, "Sync now", and the recovery key that links data encrypted before joining. */
function SyncRows() {
  const toast = useToast();
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const off = window.radar.sync.onChanged(setSync);
    window.radar.sync.status().then(setSync, (err: unknown) => {
      console.error('[sync] status unavailable', err);
    });
    // "Last synced 3 min ago" stays current.
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);

  if (!sync) return null;
  const label = syncLabel(sync, now);
  const needsKey = sync.state === 'needs-recovery-key';

  const syncNow = () => {
    setBusy(true);
    window.radar.sync.now().then(
      (s) => {
        setBusy(false);
        setSync(s);
      },
      (err: unknown) => {
        setBusy(false);
        toast({ tone: 'error', message: `Not synced: ${cleanIpcError(err)}` });
      },
    );
  };

  const link = (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryKey.trim()) return;
    setBusy(true);
    setError(null);
    window.radar.sync.useRecoveryKey(recoveryKey).then(
      (s) => {
        setBusy(false);
        setRecoveryKey('');
        setSync(s);
        toast({ tone: 'success', message: 'This computer now syncs with your account' });
      },
      (err: unknown) => {
        setBusy(false);
        setError(cleanIpcError(err));
      },
    );
  };

  return (
    <>
      <GroupedRow icon={RefreshCw} tile="sky" title="Sync" description={label.detail}>
        <Badge tone={label.tone} size="sm">
          {label.text}
        </Badge>
        {sync.state !== 'off' && !needsKey && (
          <Button size="sm" disabled={busy || sync.state === 'syncing'} onClick={syncNow}>
            Sync now
          </Button>
        )}
      </GroupedRow>
      {needsKey && (
        <GroupedRow
          icon={KeyRound}
          tile="indigo"
          title="Link this computer"
          description="From then on, your account's recovery key opens the data here (the one saved for this computer stops working)."
          below={
            <form className="flex flex-col gap-1.5" onSubmit={link} noValidate>
              <div className="flex items-center gap-2">
                <TextInput
                  size="sm"
                  aria-label="Recovery key"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="XXXX-XXXX-XXXX-…"
                  className="font-mono"
                  value={recoveryKey}
                  invalid={error !== null}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  disabled={busy || !recoveryKey.trim()}
                >
                  {busy ? 'Linking…' : 'Link'}
                </Button>
              </div>
              {error && <div className="text-caption text-red">{error}</div>}
            </form>
          }
        />
      )}
    </>
  );
}

/**
 * Settings > Account: who is signed in, whether the session is connected, sync, and Sign out.
 * Signing out locks Radar; the same account signs in again to open the data on this computer.
 */
export function AccountSection() {
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = window.radar.auth.onChanged(setStatus);
    window.radar.auth.status().then(setStatus, (err: unknown) => {
      console.error('[account] status unavailable', err);
    });
    return off;
  }, []);

  if (status?.state !== 'unlocked' || !status.account) return null;
  const { account, session } = status;
  const label = sessionLabel(session);
  const expired = session === 'expired';

  const signOut = () => {
    setBusy(true);
    window.radar.auth.signOut().then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false);
        console.error('[account] sign-out failed', err);
        toast({ tone: 'error', message: `Not signed out: ${cleanIpcError(err)}` });
      },
    );
  };

  return (
    <GroupedSection title="Account">
      <GroupedRow
        icon={UserRound}
        tile="indigo"
        title={account.email}
        description={
          account.provider === 'google'
            ? 'Signed in with Google. Your Radar password opens the data on this computer.'
            : 'Signed in with email. Your account password also opens the data on this computer.'
        }
      >
        <Badge tone={label.tone} size="sm">
          {label.text}
        </Badge>
      </GroupedRow>
      <SyncRows />
      <GroupedRow
        icon={LogOut}
        tile="gray"
        title={expired ? 'Sign in again' : 'Sign out'}
        description={
          expired
            ? 'Your session ended. Radar locks; sign in again to reconnect.'
            : 'Locks Radar on this computer. Your data stays here, encrypted.'
        }
      >
        <Button
          size="sm"
          variant={expired ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={signOut}
        >
          {expired ? 'Sign in again' : 'Sign out'}
        </Button>
      </GroupedRow>
    </GroupedSection>
  );
}
