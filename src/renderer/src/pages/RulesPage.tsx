import { ChevronDown, ChevronUp, RefreshCw, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
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
  listById,
  rescoreSummary,
  roleGroupList,
  sameRules,
  scorePreview,
  setGroupPoints,
  setThreshold,
  signed,
  verdictReason,
  weightsIn,
  type ListDef,
  type WeightDef,
} from '../lib/rules';
import { profileFromSettings } from '../../../core/rules/profile';
import { cleanIpcError } from '../lib/settings-helpers';
import { useSettings } from '../state/settings';
import { PageTitle } from './PageTitle';

function Card({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-4 rounded-2xl bg-surface px-4.5 py-4 hairline border-line shadow-card',
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

/** "machine learning, ml, ai, ia, … +19": a list in one quiet line. */
function summary(items: readonly string[], shown = 4): string {
  const head = items.slice(0, shown).join(', ');
  return items.length > shown ? `${head}, … +${items.length - shown}` : head;
}

/** The small "23 keywords" toggle at the end of a row that has a list. */
function ListToggle({
  count,
  noun,
  open,
  onToggle,
}: {
  count: number;
  noun: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="plain"
      iconRight={open ? ChevronUp : ChevronDown}
      aria-expanded={open}
      onClick={onToggle}
    >
      {count} {count === 1 ? noun : noun === 'company' ? 'companies' : `${noun}s`}
    </Button>
  );
}

/** The editor that opens under a row (chips with remove buttons and an add field). */
function ListPanel({ children }: { children: ReactNode }) {
  return <div className="mb-2 rounded-xl bg-fill px-3 py-2.5">{children}</div>;
}

const minus = (v: number) => (v === 0 ? '0' : `−${v}`);

interface RowProps {
  w: WeightDef;
  draft: Rules;
  saved: Rules;
  onChange: (r: Rules) => void;
  open: string | null;
  onToggle: (id: string) => void;
}

/**
 * One weight. Bonuses are edited as they are stored; penalties by their strength (dragging right
 * makes the penalty bigger) and shown in red as negative points. A weight that applies to a list
 * (stack keywords, watchlist) shows the list's size and opens it in place.
 */
function WeightRow({ w, draft, saved, onChange, open, onToggle }: RowProps) {
  const list = w.list ? listById(w.list) : undefined;
  const penalty = w.section === 'penalty';
  const value = w.get(draft);
  return (
    <div className="hairline-t border-line first:border-0">
      <Slider
        layout="compact"
        label={w.label}
        description={w.description}
        tone={penalty ? 'red' : 'accent'}
        value={penalty ? -value : value}
        min={penalty ? -w.max : w.min}
        max={penalty ? -w.min : w.max}
        format={penalty ? minus : signed}
        changed={w.get(saved) !== value}
        onChange={(v) => onChange(w.set(draft, penalty ? -v : v))}
        trailing={
          list ? (
            <ListToggle
              count={list.get(draft).length}
              noun={list.noun}
              open={open === w.id}
              onToggle={() => onToggle(w.id)}
            />
          ) : null
        }
      />
      {list && open === w.id && (
        <ListPanel>
          <Keywords list={list} rules={draft} onChange={onChange} />
        </ListPanel>
      )}
    </div>
  );
}

const SECTIONS = [
  { id: 'rules-verdicts', label: 'Verdicts' },
  { id: 'rules-role', label: 'Role match' },
  { id: 'rules-bonuses', label: 'Bonuses' },
  { id: 'rules-penalties', label: 'Penalties' },
] as const;

export function RulesPage() {
  const { settings } = useSettings();
  const toast = useToast();
  const [state, setState] = useState<RulesState | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // The one list open for editing (a weight id, "role-<i>" or "excludes"); the rest stay folded.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

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

      <nav aria-label="Rule sections" className="mb-3.5 flex flex-wrap gap-1.5">
        {SECTIONS.map((sec) => (
          <Button
            key={sec.id}
            size="sm"
            onClick={() =>
              document
                .getElementById(sec.id)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            {sec.label}
          </Button>
        ))}
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
        <div className="flex flex-col gap-4">
          <Card
            id="rules-verdicts"
            title="Verdicts"
            description="Each posting scores out of 100. Below Maybe is Skip; results are never deleted."
          >
            <div className="mt-1 mb-1 flex h-7 overflow-hidden rounded-sm text-caption font-semibold">
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
              layout="compact"
              label="Maybe from"
              value={draft.thresholds.maybe}
              min={0}
              max={100}
              changed={saved.thresholds.maybe !== draft.thresholds.maybe}
              trailing={null}
              onChange={(v) => setDraft(setThreshold(draft, 'maybe', v))}
            />
            <Slider
              layout="compact"
              label="Apply from"
              value={draft.thresholds.apply}
              min={0}
              max={100}
              changed={saved.thresholds.apply !== draft.thresholds.apply}
              trailing={null}
              onChange={(v) => setDraft(setThreshold(draft, 'apply', v))}
            />
          </Card>

          <Card
            id="rules-role"
            title="Role match"
            description="Points for what the title says. The best matching group counts, and your roles from Settings count too."
          >
            {weightsIn('role').map((w) => (
              <WeightRow
                key={w.id}
                w={w}
                draft={draft}
                saved={saved}
                onChange={setDraft}
                open={open}
                onToggle={toggle}
              />
            ))}
            {draft.role.groups.map((g, i) => {
              const list = roleGroupList(i);
              const id = `role-${i}`;
              return (
                <div key={g.label} className="hairline-t border-line">
                  <Slider
                    layout="compact"
                    label={g.label}
                    description={summary(g.terms)}
                    value={g.points}
                    min={0}
                    max={40}
                    format={signed}
                    changed={saved.role.groups[i]?.points !== g.points}
                    onChange={(v) => setDraft(setGroupPoints(draft, i, v))}
                    trailing={
                      <ListToggle
                        count={g.terms.length}
                        noun="keyword"
                        open={open === id}
                        onToggle={() => toggle(id)}
                      />
                    }
                  />
                  {open === id && (
                    <ListPanel>
                      <Keywords list={list} rules={draft} onChange={setDraft} />
                    </ListPanel>
                  )}
                </div>
              );
            })}
          </Card>

          <Card
            id="rules-bonuses"
            title="Bonuses"
            description="Points added when a posting has the signal"
          >
            {weightsIn('bonus').map((w) => (
              <WeightRow
                key={w.id}
                w={w}
                draft={draft}
                saved={saved}
                onChange={setDraft}
                open={open}
                onToggle={toggle}
              />
            ))}
          </Card>

          <Card
            id="rules-penalties"
            title="Penalties"
            description="Points taken away. Drag right for a bigger penalty."
          >
            {weightsIn('penalty').map((w) => (
              <WeightRow
                key={w.id}
                w={w}
                draft={draft}
                saved={saved}
                onChange={setDraft}
                open={open}
                onToggle={toggle}
              />
            ))}
            <div className="hairline-t border-line">
              <div className="grid grid-cols-[minmax(0,1fr)_13rem_44px_8.5rem] items-center gap-3.5 py-2">
                <div className="min-w-0">
                  <div className="truncate text-body font-medium">
                    {listById('excludes')!.title}
                  </div>
                  <div className="truncate text-footnote text-fg-3">
                    {listById('excludes')!.description}
                  </div>
                </div>
                <span />
                <span className="text-right text-body font-semibold text-red">Skip</span>
                <div className="flex justify-end">
                  <ListToggle
                    count={listById('excludes')!.get(draft).length}
                    noun={listById('excludes')!.noun}
                    open={open === 'excludes'}
                    onToggle={() => toggle('excludes')}
                  />
                </div>
              </div>
              {open === 'excludes' && (
                <ListPanel>
                  <Keywords list={listById('excludes')!} rules={draft} onChange={setDraft} />
                </ListPanel>
              )}
            </div>
          </Card>
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
                    <div
                      className="truncate text-caption text-fg-3"
                      title={verdictReason(result, draft.thresholds.maybe)}
                    >
                      {verdictReason(result, draft.thresholds.maybe)}
                    </div>
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
