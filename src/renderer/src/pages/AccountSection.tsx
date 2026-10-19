import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { GroupedRow, GroupedSection } from '../../components/GroupedList';
import { useToast } from '../../components/Toast';
import { sessionLabel } from '../lib/lock';
import { cleanIpcError } from '../lib/settings-helpers';

/**
 * Settings > Account: who is signed in, whether the session is connected, and Sign out. Signing
 * out locks Radar; the same account signs in again to open the data on this computer.
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
