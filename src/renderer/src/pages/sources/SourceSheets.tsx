import { CircleAlert, CircleCheck, ExternalLink, Play, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { NewSource, SourceItem, TestResult } from '../../../../shared/ipc';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { Icon } from '../../../components/Icon';
import { TextInput } from '../../../components/Input';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Select } from '../../../components/Select';
import {
  BOARD_LABELS,
  BOARD_LINK_HINT,
  BOARD_PLATFORMS,
  boardPageUrl,
  detectBoard,
  type BoardPlatform,
} from '../../../../core/sources/boards';
import { Shimmer, Skeleton } from '../../../components/Skeleton';

const TYPE_LABEL: Record<string, string> = {
  internship: 'Internship',
  pfe: 'PFE',
  junior: 'Junior',
  fulltime: 'Job',
  program: 'Program',
  unknown: 'Job', // scans store an unknown type as a regular job
};

/** Status chips and what came back. Shared by the Test fetch sheet and the Add source preview. */
export function TestOutcome({
  result,
  limit,
  onOpenLink,
}: {
  result: TestResult;
  limit?: number;
  onOpenLink: (url: string) => void;
}) {
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="red" strong icon={CircleAlert}>
            Failed
          </Badge>
          <Badge>{(result.ms / 1000).toFixed(1)} s</Badge>
        </div>
        <div className="rounded-lg bg-red-soft px-3 py-2.5 text-subhead text-red">
          {result.error}
        </div>
      </div>
    );
  }
  const stats =
    result.kind === 'items'
      ? [
          `${result.total} ${result.total === 1 ? 'item' : 'items'} parsed`,
          ...(result.skipped ? [`${result.skipped} skipped`] : []),
        ]
      : [`${result.totalLines} lines of text`];
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="green" strong icon={CircleCheck}>
          OK
        </Badge>
        <Badge>{(result.ms / 1000).toFixed(1)} s</Badge>
        {stats.map((s) => (
          <Badge key={s}>{s}</Badge>
        ))}
      </div>
      {result.kind === 'items' ? (
        result.items.length === 0 ? (
          <div className="text-subhead text-fg-2">
            The source answered but lists nothing right now.
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {result.items.slice(0, limit).map((i) => (
              <li
                key={i.url}
                className="flex items-center gap-2.5 py-2 hairline-t border-line first:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium">{i.title}</div>
                  <div className="truncate text-footnote text-fg-3">
                    {[i.org, i.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <Badge size="sm">{TYPE_LABEL[i.type] ?? i.type}</Badge>
                <button
                  type="button"
                  aria-label={`Open ${i.title}`}
                  onClick={() => onOpenLink(i.url)}
                  className="focus-ring grid size-6 place-items-center rounded-xs text-fg-3 hover:bg-fill hover:text-fg-2"
                >
                  <Icon icon={ExternalLink} size={13} />
                </button>
              </li>
            ))}
            {result.total > Math.min(limit ?? Infinity, result.items.length) && (
              <li className="pt-2 text-footnote text-fg-3 hairline-t border-line">
                Showing the first {Math.min(limit ?? Infinity, result.items.length)} of{' '}
                {result.total}.
              </li>
            )}
          </ul>
        )
      ) : (
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-caption-2 leading-relaxed text-fg-2">
          {result.lines.slice(0, limit).map((l, i) => (
            <div key={i} className="truncate">
              {l}
            </div>
          ))}
          {result.totalLines > (limit ?? result.lines.length) && <div className="text-fg-3">…</div>}
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="relative flex flex-col gap-2 overflow-hidden">
      <Shimmer />
      <Skeleton className="h-5 w-48" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** "Test fetch" sheet: fetches like a scan would and saves nothing. */
export function TestSheet({
  source,
  result,
  onClose,
  onOpenLink,
  onDelete,
}: {
  source: SourceItem | null;
  /** null while fetching. */
  result: TestResult | null;
  onClose: () => void;
  onOpenLink: (url: string) => void;
  onDelete: (s: SourceItem) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Drawer open={source !== null} onClose={onClose} label={`Test fetch ${source?.name ?? ''}`}>
      <header className="flex items-center gap-3 px-5 pt-5 pb-4 hairline-b border-line">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-title-2 font-semibold tracking-title-2">Test fetch</h2>
          <div className="truncate text-subhead text-fg-2">{source?.name}</div>
        </div>
        <DrawerClose onClose={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg px-5 py-4.5">
        {result ? <TestOutcome result={result} onOpenLink={onOpenLink} /> : <Loading />}
      </div>
      <footer className="flex items-center gap-2 px-5 py-3.5 hairline-t border-line">
        {source?.added_by_user && (
          <Button
            variant="plain"
            icon={Trash2}
            className="text-red"
            onClick={() => setConfirm(true)}
          >
            Delete source
          </Button>
        )}
        <span className="ml-auto text-footnote text-fg-3">Nothing is saved.</span>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
      <ConfirmDialog
        open={confirm}
        title={`Delete ${source?.name ?? 'this source'}?`}
        message="Radar stops fetching it. Sources that already found postings are kept; pause those instead."
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          if (source) onDelete(source);
        }}
      />
    </Drawer>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote font-semibold text-fg-2">
        {label}
      </label>
      {children(id)}
      {hint && <div className="text-caption text-fg-3">{hint}</div>}
    </div>
  );
}

type Kind = 'board' | 'page';

const PLATFORM_OPTIONS = BOARD_PLATFORMS.map((p) => ({ value: p, label: BOARD_LABELS[p] }));

/**
 * "Add source": a job board (Ashby, Greenhouse, Lever or Recruitee; a pasted link picks the platform) or a
 * web page to watch, with a test fetch before adding.
 */
export function AddSourceSheet({
  open,
  onClose,
  onAdd,
  onTest,
  onOpenLink,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (s: NewSource) => Promise<boolean>;
  onTest: (s: NewSource) => Promise<TestResult | null>;
  onOpenLink: (url: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('board');
  const [platform, setPlatform] = useState<BoardPlatform>('ashby');
  const [board, setBoard] = useState('');
  const [org, setOrg] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const source: NewSource =
    kind === 'board' ? { type: platform, board, org } : { type: 'page', name, url };
  const ready =
    kind === 'board'
      ? board.trim() !== '' && org.trim() !== ''
      : name.trim() !== '' && /^https?:\/\/\S+\.\S+/i.test(url.trim());

  async function test() {
    setTesting(true);
    setPreview(null);
    setPreview(await onTest(source));
    setTesting(false);
  }

  return (
    <Drawer open={open} onClose={onClose} label="Add source">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || saving) return;
          setSaving(true);
          void onAdd(source).then((ok) => {
            setSaving(false);
            if (ok) onClose();
          });
        }}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 hairline-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-title-2 font-semibold tracking-title-2">Add source</h2>
            <div className="text-subhead text-fg-2">
              Radar fetches it on every scan and scores what it finds.
            </div>
          </div>
          <DrawerClose onClose={onClose} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg px-5 py-4.5">
          <SegmentedControl
            label="Source type"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPreview(null);
            }}
            segments={[
              { value: 'board', label: 'Job board' },
              { value: 'page', label: 'Web page to watch' },
            ]}
          />
          {kind === 'board' ? (
            <>
              <Field
                label="Board link or name"
                hint={`From the company's careers page, e.g. ${BOARD_LINK_HINT[platform]}. A pasted link picks the platform.`}
              >
                {(id) => (
                  <TextInput
                    id={id}
                    autoFocus
                    value={board}
                    placeholder={`${boardPageUrl(platform, '')}…`}
                    onChange={(e) => {
                      setBoard(e.target.value);
                      const found = detectBoard(e.target.value);
                      if (found && found.platform !== platform) {
                        setPlatform(found.platform);
                        setPreview(null);
                      }
                    }}
                  />
                )}
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span className="text-subhead text-fg-2">Platform</span>
                <Select
                  label="Platform"
                  value={platform}
                  options={PLATFORM_OPTIONS}
                  onChange={(p) => {
                    setPlatform(p);
                    setPreview(null);
                  }}
                />
              </div>
              <Field label="Company name">
                {(id) => <TextInput id={id} value={org} onChange={(e) => setOrg(e.target.value)} />}
              </Field>
            </>
          ) : (
            <>
              <Field label="Name">
                {(id) => (
                  <TextInput
                    id={id}
                    autoFocus
                    value={name}
                    placeholder="e.g. Lab internships page"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Page URL"
                hint="Checked about once a day; a change raises a review alert."
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={url}
                    placeholder="https://"
                    onChange={(e) => setUrl(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
          {(testing || preview) && (
            <div className="rounded-2xl bg-surface p-3.5 hairline border-line shadow-card">
              {preview ? (
                <TestOutcome result={preview} limit={6} onOpenLink={onOpenLink} />
              ) : (
                <Loading />
              )}
            </div>
          )}
          <p className="m-0 text-footnote text-fg-3">
            Every request goes through Radar&apos;s polite fetch layer: robots.txt is respected and
            each site gets at most one request per second. Indeed, LinkedIn and Glassdoor are never
            scraped.
          </p>
        </div>
        <footer className="flex items-center gap-2 px-5 py-3.5 hairline-t border-line">
          <Button icon={Play} disabled={!ready || testing} onClick={() => void test()}>
            Test fetch
          </Button>
          <span className="ml-auto" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ready || saving}>
            Add source
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}
