import { Download, Plus, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Shimmer, Skeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { zonedParts } from '../../../../core/time';
import { deadlinesSubtitle, dueSoon, shiftMonth } from '../../lib/deadlines';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { AddDeadlineDrawer } from './AddDeadlineDrawer';
import { DeadlineList, DueSoon, MonthView } from './DeadlineViews';
import { useDeadlines } from './useDeadlines';

type ViewMode = 'list' | 'month';
const VIEW_KEY = 'radar.deadlines.view';

function savedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'list';
  } catch {
    return 'list';
  }
}

export function DeadlinesPage() {
  const { settings } = useSettings();
  const tz = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const api = useDeadlines();
  const toast = useToast();
  const [mode, setMode] = useState<ViewMode>(savedView);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [shown, setShown] = useState(() => {
    const p = zonedParts(new Date(), tz);
    return { year: p.year, month: p.month };
  });

  const events = useMemo(() => api.view?.events ?? [], [api.view]);
  const due = dueSoon(events, api.view?.followups ?? [], now, tz);

  function changeMode(m: ViewMode) {
    setMode(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch {
      // Per-viewer convenience only.
    }
  }

  async function exportIcs() {
    setExporting(true);
    try {
      const r = await window.radar.deadlines.exportIcs();
      if (r)
        toast({
          message: `Exported ${r.count} ${r.count === 1 ? 'date' : 'dates'} to ${r.file.split(/[\\/]/).pop()}`,
        });
    } catch (err) {
      console.error('[deadlines] export failed', err);
      toast({ tone: 'error', message: `Export failed: ${cleanIpcError(err)}` });
    } finally {
      setExporting(false);
    }
  }

  const actions = {
    onOpenLink: (url: string) =>
      void window.radar.app
        .openExternal(url)
        .catch((err: unknown) =>
          toast({ tone: 'error', message: `Could not open the link: ${cleanIpcError(err)}` }),
        ),
    onDeleteManual: (id: number, title: string) => void api.remove(id, title),
  };

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle title="Deadlines" subtitle={deadlinesSubtitle(events, now, tz)} />
        <div className="flex items-center gap-2">
          <SegmentedControl
            label="View"
            value={mode}
            onChange={changeMode}
            segments={[
              { value: 'list', label: 'List' },
              { value: 'month', label: 'Month' },
            ]}
          />
          <Button
            icon={Download}
            disabled={exporting || events.length === 0}
            onClick={() => void exportIcs()}
          >
            Export .ics
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add deadline
          </Button>
        </div>
      </div>

      {api.error ? (
        <Banner
          title="Deadlines could not be loaded."
          description={api.error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void api.reload()}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5">
          <div className="overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card">
            {api.view === null ? (
              <div className="relative">
                <Shimmer />
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex h-14 items-center gap-3 px-4 hairline-t border-line">
                    <Skeleton className="h-8 w-10" />
                    <Skeleton className="size-7" strong />
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))}
              </div>
            ) : mode === 'list' ? (
              <DeadlineList events={events} now={now} tz={tz} actions={actions} />
            ) : (
              <MonthView
                year={shown.year}
                month={shown.month}
                events={events}
                now={now}
                tz={tz}
                onMove={(d) => setShown((s) => shiftMonth(s.year, s.month, d))}
                onToday={() => {
                  const p = zonedParts(new Date(), tz);
                  setShown({ year: p.year, month: p.month });
                }}
              />
            )}
          </div>
          <DueSoon
            items={due}
            now={now}
            tz={tz}
            onSnooze={(i) => void api.snooze(i)}
            onDone={(i) => void api.done(i)}
          />
        </div>
      )}

      <AddDeadlineDrawer
        key={adding ? 'open' : 'closed'}
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={api.add}
      />
    </div>
  );
}
