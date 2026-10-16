import {
  Braces,
  Globe,
  Hand,
  Inbox,
  Play,
  Plus,
  RotateCw,
  Rss,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { NewSource, SourceItem, TestResult } from '../../../../shared/ipc';
import { StatusDot } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/Toast';
import { cn } from '../../../components/lib/cn';
import { notifyDataChanged } from '../../lib/data-events';
import { cleanIpcError } from '../../lib/settings-helpers';
import {
  brokenNote,
  errorLine,
  groupSources,
  HEALTH_DOT,
  HEALTH_LABEL,
  lastRun,
  sourceDetail,
  sourcesSubtitle,
  type AccessMethod,
} from '../../lib/sources';
import { useScan } from '../../state/scan';
import { PageTitle } from '../PageTitle';
import { AddSourceSheet, TestSheet } from './SourceSheets';

const GROUP_ICON: Record<AccessMethod, LucideIcon> = {
  api: Braces,
  rss: Rss,
  public_html: Globe,
  email_alert: Inbox,
  manual: Hand,
};
const COLUMNS = 'minmax(0,1fr) 104px 64px 180px 40px 98px';

function Row({
  s,
  first,
  now,
  onPause,
  onTest,
}: {
  s: SourceItem;
  first: boolean;
  now: Date;
  onPause: (paused: boolean) => void;
  onTest: () => void;
}) {
  const err = errorLine(s);
  const note = brokenNote(s);
  return (
    <div className={cn(!first && 'hairline-t border-line')}>
      <div
        className="grid min-h-14 items-center gap-x-3.5 px-4 py-2"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span title={HEALTH_LABEL[s.health]} className="shrink-0">
            <StatusDot tone={HEALTH_DOT[s.health]} />
            <span className="sr-only">{HEALTH_LABEL[s.health]}</span>
          </span>
          <div className="min-w-0">
            <div className="truncate text-body font-semibold">{s.name}</div>
            <div className="truncate text-footnote text-fg-3" title={s.tos_note ?? undefined}>
              {sourceDetail(s)}
            </div>
          </div>
        </div>
        <div className="text-subhead text-fg-2">
          <div className="text-micro text-fg-3">Last run</div>
          {lastRun(s.last_ok_at, now)}
        </div>
        <div className="text-subhead tabular-nums">
          <div className="text-micro text-fg-3">Found</div>
          <span
            className={cn(
              'font-semibold',
              s.found === 0 && s.health !== 'new' && s.health !== 'unavailable'
                ? 'text-red'
                : 'text-fg',
            )}
          >
            {s.found ?? '—'}
          </span>
        </div>
        <div className="min-w-0 text-subhead">
          <div className="text-micro text-fg-3">Last error</div>
          <div
            className={cn(
              'truncate',
              err.tone === 'red' ? 'text-red' : err.tone === 'amber' ? 'text-amber' : 'text-fg-3',
            )}
            title={err.text}
          >
            {err.text}
          </div>
        </div>
        <Switch
          checked={!s.paused && s.health !== 'unavailable'}
          disabled={s.health === 'unavailable'}
          label={`${s.paused ? 'Resume' : 'Pause'} ${s.name}`}
          onChange={(on) => onPause(!on)}
        />
        <Button size="sm" icon={Play} disabled={s.health === 'unavailable'} onClick={onTest}>
          Test fetch
        </Button>
      </div>
      {note && (
        <div className="mx-4 mb-3.5 ml-9 flex items-center gap-2.5 rounded-lg bg-red-soft px-3 py-2.5 text-red">
          <Icon icon={CircleAlert} size={16} />
          <span className="text-body font-semibold">{note.title}</span>
          <span className="text-subhead text-fg-2">{note.detail}</span>
          <button
            type="button"
            onClick={onTest}
            className="focus-ring ml-auto rounded-2xs text-subhead font-semibold whitespace-nowrap"
          >
            Test fetch
          </button>
        </div>
      )}
    </div>
  );
}

export function SourcesPage() {
  const toast = useToast();
  const scan = useScan();
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<{ source: SourceItem; result: TestResult | null } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[sources] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      window.radar.sources.list().then(
        (list) => {
          setItems(list);
          setError(null);
          notifyDataChanged();
        },
        (err: unknown) => {
          console.error('[sources] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  // First load, and after every scan (health and counts change).
  useEffect(() => {
    void reload();
  }, [reload, scan.version]);

  const openLink = (url: string) =>
    void window.radar.app.openExternal(url).catch((err: unknown) => fail('Open link', err));

  async function pause(s: SourceItem, paused: boolean) {
    try {
      await window.radar.sources.setPaused(s.id, paused);
      await reload();
      toast({
        message: `${paused ? 'Paused' : 'Resumed'} ${s.name}`,
        action: {
          label: 'Undo',
          onAction: () =>
            void window.radar.sources
              .setPaused(s.id, !paused)
              .then(reload, (err: unknown) => fail('Undo', err)),
        },
      });
    } catch (err) {
      fail(paused ? 'Pause' : 'Resume', err);
    }
  }

  async function test(s: SourceItem) {
    setTesting({ source: s, result: null });
    try {
      const result = await window.radar.sources.test({ id: s.id });
      setTesting((t) => (t?.source.id === s.id ? { source: s, result } : t));
    } catch (err) {
      setTesting(null);
      fail('Test fetch', err);
    }
  }

  async function testNew(source: NewSource): Promise<TestResult | null> {
    try {
      return await window.radar.sources.test({ source });
    } catch (err) {
      fail('Test fetch', err);
      return null;
    }
  }

  async function add(source: NewSource): Promise<boolean> {
    try {
      const added = await window.radar.sources.add(source);
      await reload();
      toast({ message: `Added ${added.name}. It is fetched on the next scan.` });
      return true;
    } catch (err) {
      fail('Add source', err);
      return false;
    }
  }

  async function remove(s: SourceItem) {
    try {
      await window.radar.sources.remove(s.id);
      setTesting(null);
      await reload();
      toast({ message: `Deleted ${s.name}` });
    } catch (err) {
      fail('Delete', err);
    }
  }

  const groups = groupSources(items ?? []);
  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle
          title="Sources"
          subtitle={
            items
              ? sourcesSubtitle(items)
              : 'Boards, feeds and pages Radar searches, with their health.'
          }
        />
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
          Add source
        </Button>
      </div>

      {error ? (
        <Banner
          title="Sources could not be loaded."
          description={error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      ) : items === null ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 hairline border-line shadow-card">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.method} aria-label={g.label}>
              <h2 className="m-0 mb-2 ml-1 flex items-center gap-1.75 text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
                <Icon icon={GROUP_ICON[g.method]} size={13} />
                {g.label}
                <span className="font-medium tracking-normal normal-case">
                  · {g.items.length} {g.items.length === 1 ? 'source' : 'sources'}
                </span>
              </h2>
              <div className="overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card">
                {g.items.map((s, i) => (
                  <Row
                    key={s.id}
                    s={s}
                    first={i === 0}
                    now={now}
                    onPause={(p) => void pause(s, p)}
                    onTest={() => void test(s)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <TestSheet
        key={testing?.source.id ?? 'none'}
        source={testing?.source ?? null}
        result={testing?.result ?? null}
        onClose={() => setTesting(null)}
        onOpenLink={openLink}
        onDelete={(s) => void remove(s)}
      />
      <AddSourceSheet
        key={adding ? 'open' : 'closed'}
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={add}
        onTest={testNew}
        onOpenLink={openLink}
      />
    </div>
  );
}
