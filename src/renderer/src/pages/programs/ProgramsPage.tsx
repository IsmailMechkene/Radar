import { Plus, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Skeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { programsSubtitle } from '../../lib/programs';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { ProgramCard } from './ProgramCard';
import { ProgramDrawer } from './ProgramDrawer';
import { usePrograms } from './usePrograms';

const WIDE_MIN = 1200;

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_MIN);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= WIDE_MIN);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

export function ProgramsPage() {
  const { settings } = useSettings();
  const tz = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const api = usePrograms();
  const toast = useToast();
  const wide = useWide();
  const [editing, setEditing] = useState<{ id: number | null; fromAlert: boolean } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = api.items ?? [];
  const item = editing?.id != null ? (items.find((p) => p.id === editing.id) ?? null) : null;
  const openLink = (url: string) =>
    void window.radar.app
      .openExternal(url)
      .catch((err: unknown) =>
        toast({ tone: 'error', message: `Could not open the link: ${cleanIpcError(err)}` }),
      );

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle title="Programs" subtitle={programsSubtitle(items)} />
        <Button icon={Plus} onClick={() => setEditing({ id: null, fromAlert: false })}>
          Watch a program
        </Button>
      </div>

      {api.error ? (
        <Banner
          title="Programs could not be loaded."
          description={api.error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void api.reload()}>
              Retry
            </Button>
          }
        />
      ) : (
        <div
          className={
            wide ? 'grid grid-cols-3 items-start gap-4' : 'grid grid-cols-2 items-start gap-4'
          }
        >
          {api.items === null
            ? Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 rounded-2xl bg-surface p-4.5 hairline border-line shadow-card"
                >
                  <div className="flex gap-3">
                    <Skeleton className="size-10" strong />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-36" strong />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                </div>
              ))
            : items.map((p) => (
                <ProgramCard
                  key={p.id}
                  p={p}
                  now={now}
                  tz={tz}
                  checking={api.checking.has(p.id)}
                  onEdit={(fromAlert) => setEditing({ id: p.id, fromAlert })}
                  onCheck={() => void api.check(p)}
                  onReviewed={() => void api.markReviewed(p)}
                  onOpenLink={openLink}
                />
              ))}
        </div>
      )}

      <ProgramDrawer
        key={editing ? `${editing.id ?? 'new'}:${editing.fromAlert}` : 'closed'}
        item={item}
        creating={editing !== null && editing.id === null}
        fromAlert={editing?.fromAlert ?? false}
        tz={tz}
        onClose={() => setEditing(null)}
        onSave={(patch) => (item ? api.save(item.id, patch, item.name) : Promise.resolve(false))}
        onCreate={api.create}
        onDelete={api.remove}
      />
    </div>
  );
}
