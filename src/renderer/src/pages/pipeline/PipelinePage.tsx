import { FileUp, Kanban, Plus, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImportResult } from '../../../../shared/ipc';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { followupsDue, pipelineSubtitle } from '../../lib/pipeline';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { PipelineDrawer } from './PipelineDrawer';
import { PipelineSkeleton, PipelineTable, StatusStrip } from './PipelineTable';
import { usePipeline } from './usePipeline';

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

/** Problems from the last import, listed until dismissed (nothing is dropped silently). */
function ImportReport({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  return (
    <div role="status" className="mb-4 rounded-lg bg-amber-soft px-3.5 py-3 text-subhead">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-amber">
          Imported {result.added}, skipped {result.skipped} already there. {result.problems.length}{' '}
          to check:
        </span>
        <button
          type="button"
          aria-label="Dismiss import report"
          onClick={onClose}
          className="focus-ring ml-auto grid size-6 place-items-center rounded-xs text-fg-2 hover:bg-fill"
        >
          <Icon icon={X} size={14} />
        </button>
      </div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg-2">
        {result.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {result.ignoredColumns.length > 0 && (
        <div className="mt-1.5 text-fg-3">Columns not used: {result.ignoredColumns.join(', ')}</div>
      )}
    </div>
  );
}

export function PipelinePage() {
  const { settings } = useSettings();
  const timeZone = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const api = usePipeline();
  const toast = useToast();
  const wide = useWide();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  // One clock per render pass keeps "due" consistent between the strip, rows and subtitle.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const items = useMemo(() => api.items ?? [], [api.items]);
  const due = followupsDue(items, now);
  const openItem = items.find((i) => i.id === openId) ?? null;

  const close = useCallback(() => {
    setOpenId(null);
    setCreating(false);
  }, []);

  async function importCsv() {
    setImporting(true);
    try {
      const r = await window.radar.pipeline.importCsv();
      if (!r) return; // dialog cancelled
      await api.reload();
      toast({
        message: `Imported ${r.added} ${r.added === 1 ? 'entry' : 'entries'}${r.skipped ? ` · ${r.skipped} already there` : ''}`,
      });
      setReport(r.problems.length || r.ignoredColumns.length ? r : null);
    } catch (err) {
      console.error('[pipeline] import failed', err);
      toast({ tone: 'error', message: `Import failed: ${cleanIpcError(err)}` });
    } finally {
      setImporting(false);
    }
  }

  const loading = api.items === null && !api.error;
  return (
    <div>
      <div className="mb-4.5 flex items-end justify-between gap-4">
        <PageTitle title="Pipeline" subtitle={pipelineSubtitle(items, due)} />
        <div className="flex gap-2">
          <Button icon={FileUp} disabled={importing} onClick={() => void importCsv()}>
            Import CSV
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setOpenId(null);
              setCreating(true);
            }}
          >
            Add entry
          </Button>
        </div>
      </div>

      {report && <ImportReport result={report} onClose={() => setReport(null)} />}

      {api.error ? (
        <Banner
          title="The pipeline could not be loaded."
          description={api.error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void api.reload()}>
              Retry
            </Button>
          }
        />
      ) : loading ? (
        <PipelineSkeleton />
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-2xl bg-surface px-6 py-14 text-center hairline border-line shadow-card">
          <Icon icon={Kanban} size={18} className="text-fg-3" />
          <div className="mt-2 text-headline font-semibold">No entries yet</div>
          <p className="mt-1 max-w-110 text-subhead text-fg-2">
            Add the organizations you plan to contact, import your outreach tracker as CSV, or use
            Add to pipeline on an opportunity.
          </p>
        </div>
      ) : (
        <>
          <StatusStrip items={items} />
          <PipelineTable
            items={items}
            wide={wide}
            now={now}
            timeZone={timeZone}
            openId={openId}
            onOpen={(id) => {
              setCreating(false);
              setOpenId(id);
            }}
            onStatus={(item, status) => void api.setStatus(item, status)}
          />
        </>
      )}

      <PipelineDrawer
        key={creating ? 'new' : (openId ?? 'closed')}
        item={creating ? null : openItem}
        creating={creating}
        now={now}
        timeZone={timeZone}
        onClose={close}
        onSave={async (patch) =>
          openItem
            ? (await api.update(openItem.id, patch, `Saved ${openItem.org}`)) !== null
            : false
        }
        onCreate={async (row) => (await api.create(row)) !== null}
        onDelete={api.remove}
        onOpenLink={(url) =>
          void window.radar.app
            .openExternal(url)
            .catch((err: unknown) =>
              toast({ tone: 'error', message: `Could not open the link: ${cleanIpcError(err)}` }),
            )
        }
      />
    </div>
  );
}
