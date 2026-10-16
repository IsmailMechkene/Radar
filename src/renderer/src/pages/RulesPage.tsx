import { RefreshCw, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PreviewItem, Rules, RulesState } from '../../../shared/ipc';
import { VerdictBadge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TextInput } from '../../components/Input';
import { Chip } from '../../components/Pill';
import { ScoreRing } from '../../components/ScoreRing';
import { Skeleton } from '../../components/Skeleton';
import { Slider } from '../../components/Slider';
import { useToast } from '../../components/Toast';
import { cn } from '../../components/lib/cn';
import { notifyDataChanged } from '../lib/data-events';
import {
  canRemove,
  LISTS,
  rescoreSummary,
  roleGroupList,
  sameRules,
  scorePreview,
  setGroupPoints,
  setThreshold,
  signed,
  WEIGHTS,
  type ListDef,
} from '../lib/rules';
import { profileFromSettings } from '../../../core/rules/profile';
import { cleanIpcError } from '../lib/settings-helpers';
import { useSettings } from '../state/settings';
import { PageTitle } from './PageTitle';

function Card({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl bg-surface px-4.5 py-4 hairline border-line shadow-card',
        className,
      )}
    >
      <h2 className="m-0 text-headline font-semibold">{title}</h2>
      {description && <div className="mb-2.5 text-footnote text-fg-3">{description}</div>}
      {children}
    </section>
  );
}

/** Keyword chips with an inline add field (Enter adds; duplicates are refused). */
function Keywords({
  list,
  rules,
  onChange,
}: {
  list: ListDef;
  rules: Rules;
  onChange: (r: Rules) => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const items = list.get(rules);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <Chip
          key={item}
          label={item}
          tone={list.tone}
          removeDisabled={!canRemove(items)}
          onRemove={() =>
            onChange(
              list.set(
                rules,
                items.filter((i) => i !== item),
              ),
            )
          }
        />
      ))}
      <TextInput
        size="sm"
        className="w-36"
        value={adding}
        aria-label={`Add ${list.noun}`}
        placeholder={`Add ${list.noun}…`}
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const v = adding.trim();
          if (!v) return;
          if (items.some((i) => i.toLowerCase() === v.toLowerCase())) {
            toast({ tone: 'error', message: `“${v}” is already in the list` });
            return;
          }
          onChange(list.set(rules, [...items, v]));
          setAdding('');
        }}
      />
    </div>
  );
}

export function RulesPage() {
  const { settings } = useSettings();
  const toast = useToast();
  const [state, setState] = useState<RulesState | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([window.radar.rules.get(), window.radar.rules.preview()]).then(
        ([s, p]) => {
          setState(s);
          setDraft(s.rules);
          setPreview(p);
          setError(null);
        },
        (err: unknown) => {
          console.error('[rules] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = state && draft ? !sameRules(state.rules, draft) : false;
  const profile = useMemo(() => (settings ? profileFromSettings(settings) : null), [settings]);
  const rows = useMemo(() => {
    if (!draft || !profile) return [];
    try {
      return scorePreview(preview, draft, profile, new Date());
    } catch (err) {
      console.error('[rules] preview failed', err);
      return [];
    }
  }, [draft, preview, profile]);

  async function run(what: string, call: () => Promise<unknown>) {
    setBusy(true);
    try {
      const r = (await call()) as { scored: number; byVerdict: Record<string, number> } | null;
      await load();
      notifyDataChanged();
      toast({ message: `${what}. ${rescoreSummary(r)}` });
    } catch (err) {
      console.error(`[rules] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div>
        <PageTitle title="Rules" />
        <div className="mt-5">
          <Banner
            title="The rules could not be loaded."
            description={error}
            action={
              <Button size="sm" icon={RotateCw} onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        </div>
      </div>
    );
  }
  if (!state || !draft) {
    return (
      <div>
        <PageTitle title="Rules" />
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_380px] gap-5">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const saved = state.rules;
  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle
          title="Rules"
          subtitle="Plain scoring rules. Every point on a result traces back to one line here."
        />
        <div className="flex gap-2">
          {state.custom && !dirty && (
            <Button icon={RotateCcw} disabled={busy} onClick={() => setConfirmReset(true)}>
              Reset to defaults
            </Button>
          )}
          {dirty && (
            <Button icon={Undo2} disabled={busy} onClick={() => setDraft(state.rules)}>
              Discard changes
            </Button>
          )}
          <Button
            variant="primary"
            icon={RefreshCw}
            disabled={busy}
            onClick={() =>
              dirty
                ? void run('Rules saved', () => window.radar.rules.save(draft))
                : void run('Re-scored with the current rules', () => window.radar.rules.rescore())
            }
          >
            {dirty ? 'Save and re-score' : 'Re-score everything'}
          </Button>
        </div>
      </div>

      {state.error && (
        <div className="mb-4">
          <Banner title="Saved rules not used." description={state.error} />
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
        <div className="flex flex-col gap-4">
          <Card
            title="Role keywords"
            description="A title matching any keyword in a group gets that group's points (the best group counts)"
          >
            <div className="flex flex-col gap-3.5">
              {draft.role.groups.map((g, i) => (
                <div key={g.label} className="flex flex-col gap-1.5">
                  <Slider
                    label={g.label}
                    value={g.points}
                    min={0}
                    max={40}
                    format={signed}
                    changed={saved.role.groups[i]?.points !== g.points}
                    onChange={(v) => setDraft(setGroupPoints(draft, i, v))}
                  />
                  <Keywords list={roleGroupList(i)} rules={draft} onChange={setDraft} />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Weights" description="Points added (or taken away) when a signal is present">
            <div className="flex flex-col">
              {WEIGHTS.map((w) => (
                <Slider
                  key={w.id}
                  label={w.label}
                  description={w.description}
                  value={w.get(draft)}
                  min={w.min}
                  max={w.max}
                  format={signed}
                  changed={w.get(saved) !== w.get(draft)}
                  onChange={(v) => setDraft(w.set(draft, v))}
                />
              ))}
            </div>
          </Card>

          <Card
            title="Verdict thresholds"
            description="Below Maybe is Skip. Results are never deleted."
          >
            <div className="mb-2 flex h-7 overflow-hidden rounded-sm text-caption font-semibold">
              <div
                className="flex items-center bg-gray-soft px-2 text-gray"
                style={{ width: `${draft.thresholds.maybe}%` }}
              >
                Skip
              </div>
              <div
                className="flex items-center bg-amber-soft px-2 text-amber"
                style={{ width: `${draft.thresholds.apply - draft.thresholds.maybe}%` }}
              >
                Maybe ≥ {draft.thresholds.maybe}
              </div>
              <div className="flex flex-1 items-center bg-green-soft px-2 text-green">
                Apply ≥ {draft.thresholds.apply}
              </div>
            </div>
            <Slider
              label="Maybe from"
              value={draft.thresholds.maybe}
              min={0}
              max={100}
              changed={saved.thresholds.maybe !== draft.thresholds.maybe}
              onChange={(v) => setDraft(setThreshold(draft, 'maybe', v))}
            />
            <Slider
              label="Apply from"
              value={draft.thresholds.apply}
              min={0}
              max={100}
              changed={saved.thresholds.apply !== draft.thresholds.apply}
              onChange={(v) => setDraft(setThreshold(draft, 'apply', v))}
            />
          </Card>

          {LISTS.map((l) => (
            <Card key={l.id} title={l.title} description={l.description}>
              <Keywords list={l} rules={draft} onChange={setDraft} />
            </Card>
          ))}
        </div>

        <aside
          aria-label="Live preview"
          className="sticky top-0 rounded-2xl bg-surface px-4.5 py-4 hairline border-line shadow-card"
        >
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-headline font-semibold">Live preview</h2>
            <span className="flex items-center gap-1.5 text-caption font-semibold text-green">
              <span className="size-1.5 rounded-full bg-green-fill" />
              Live
            </span>
          </div>
          <div className="mb-2 text-footnote text-fg-3">
            Postings from your list, re-scored as you change the rules
          </div>
          {rows.length === 0 ? (
            <div className="py-6 text-center text-subhead text-fg-3">
              Scan first: the preview uses your own postings.
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map(({ item, result, delta }) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 py-2.5 hairline-t border-line first:border-0"
                >
                  <ScoreRing score={result.score} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-semibold" title={item.title}>
                      {item.title}
                    </div>
                    <div className="truncate text-footnote text-fg-2">{item.org}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <VerdictBadge verdict={result.verdict} size="sm" />
                    {delta !== null && delta !== 0 && (
                      <span
                        className={cn(
                          'text-caption font-semibold tabular-nums',
                          delta > 0 ? 'text-green' : 'text-red',
                        )}
                      >
                        {signed(Math.round(delta))} vs saved
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset rules to defaults?"
        message="Your edits are removed and everything is re-scored with seeds/rules.json."
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void run('Rules reset to defaults', () => window.radar.rules.reset());
        }}
      />
    </div>
  );
}
