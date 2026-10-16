import { Download, Folder, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo } from '../../../shared/ipc';
import { Button } from '../../components/Button';
import { GroupedRow, GroupedSection } from '../../components/GroupedList';
import { useToast } from '../../components/Toast';
import { lastBackupLine, shortPath } from '../lib/data';
import { cleanIpcError } from '../lib/settings-helpers';

/** Settings > Data (design): backups folder, back up now, and exports. */
export function DataSection({ timeZone }: { timeZone: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[data] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  useEffect(() => {
    window.radar.data.backupInfo().then(setInfo, (err: unknown) => fail('Loading backups', err));
  }, [fail]);

  async function act<T>(what: string, call: () => Promise<T>, done: (r: T) => void) {
    setBusy(what);
    try {
      done(await call());
    } catch (err) {
      fail(what, err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <GroupedSection title="Data">
      <GroupedRow
        icon={Folder}
        tile="teal"
        title="Backups folder"
        description={
          info
            ? `${shortPath(info.folder)}${info.chosen ? '' : ' (default)'} · ${lastBackupLine(info, new Date(), timeZone)}`
            : 'Loading…'
        }
      >
        <Button
          size="sm"
          icon={FolderOpen}
          aria-label="Open backups folder"
          disabled={!info}
          onClick={() =>
            void act(
              'Open folder',
              () => window.radar.data.openBackupFolder(),
              () => {},
            )
          }
        >
          Open
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act(
              'Choose folder',
              () => window.radar.data.chooseBackupFolder(),
              (r) => {
                if (!r) return;
                setInfo(r);
                toast({ message: `Backups now go to ${shortPath(r.folder)}` });
              },
            )
          }
        >
          Choose…
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act(
              'Back up',
              () => window.radar.data.backupNow(),
              (r) => {
                setInfo(r);
                toast({
                  message: `Backed up${r.pruned ? `; ${r.pruned} old backup${r.pruned === 1 ? '' : 's'} removed` : ''}`,
                });
              },
            )
          }
        >
          Back up now
        </Button>
      </GroupedRow>
      <GroupedRow
        icon={Download}
        tile="green"
        title="Data export"
        description="Everything stays on this computer. Export it any time."
      >
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act(
              'Export JSON',
              () => window.radar.data.exportJson(),
              (r) => r && toast({ message: `Exported to ${shortPath(r.path)}` }),
            )
          }
        >
          Export JSON
        </Button>
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act(
              'Export CSV',
              () => window.radar.data.exportCsv(),
              (r) =>
                r && toast({ message: `Exported ${r.files} CSV files to ${shortPath(r.path)}` }),
            )
          }
        >
          Export CSV
        </Button>
      </GroupedRow>
    </GroupedSection>
  );
}
