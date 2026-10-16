import { Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { ProgramItem, ProgramNew, ProgramPatch, ProgramStatus } from '../../../../shared/ipc';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { TextArea, TextInput } from '../../../components/Input';
import { Select } from '../../../components/Select';
import {
  DATES_LABEL,
  diffLines,
  EMPTY_PROGRAM,
  PROGRAM_STATUS_LABEL,
  programDraft,
  programPatch,
  type DatesStatus,
  type ProgramDraft,
} from '../../lib/programs';

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

const STATUS_OPTIONS = (Object.keys(PROGRAM_STATUS_LABEL) as ProgramStatus[]).map((s) => ({
  value: s,
  label: PROGRAM_STATUS_LABEL[s],
}));
const DATES_OPTIONS = (Object.keys(DATES_LABEL) as DatesStatus[]).map((s) => ({
  value: s,
  label: DATES_LABEL[s],
}));

interface Props {
  item: ProgramItem | null;
  creating: boolean;
  /** Opened from "Update deadline": dates start as confirmed and saving marks the alert reviewed. */
  fromAlert: boolean;
  tz: string;
  onClose: () => void;
  onSave: (patch: ProgramPatch) => Promise<boolean>;
  onCreate: (program: ProgramNew) => Promise<boolean>;
  onDelete: (item: ProgramItem) => Promise<boolean>;
}

/** Edit a watched program (or add one). Give it a `key` per program. */
export function ProgramDrawer(p: Props) {
  const open = p.creating || p.item !== null;
  const before = p.item ? programDraft(p.item, p.tz) : EMPTY_PROGRAM;
  const [draft, setDraft] = useState<ProgramDraft>(() =>
    p.fromAlert ? { ...before, dates: 'confirmed' } : before,
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof ProgramDraft>(k: K, v: ProgramDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const patch = programPatch(draft, before);
  const dirty = Object.keys(patch).length > 0;
  const nameMissing = draft.name.trim() === '';
  const urlBad = draft.url.trim() !== '' && !/^https?:\/\/\S+$/i.test(draft.url.trim());

  async function submit() {
    if (nameMissing || urlBad || saving) return;
    setSaving(true);
    const ok = p.creating
      ? await p.onCreate({ ...patch, name: draft.name })
      : await p.onSave(
          p.fromAlert && p.item?.alert_id ? { ...patch, review_alert_id: p.item.alert_id } : patch,
        );
    setSaving(false);
    if (ok) p.onClose();
  }

  const title = p.creating ? 'Watch a program' : (p.item?.name ?? '');
  return (
    <Drawer
      open={open}
      onClose={p.onClose}
      label={p.creating ? 'Watch a program' : `Edit ${title}`}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 hairline-b border-line">
          <h2 className="m-0 min-w-0 flex-1 truncate text-title-2 font-semibold tracking-title-2">
            {title}
          </h2>
          <DrawerClose onClose={p.onClose} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg px-5 py-4.5">
          {p.fromAlert && p.item?.alert_body && (
            <div className="rounded-lg bg-amber-soft px-3 py-2.5 text-footnote">
              <div className="font-semibold text-amber">What changed on the page</div>
              <ul className="mt-1 list-none space-y-0.5 p-0 font-mono text-caption-2 text-fg-2">
                {diffLines(p.item.alert_body).map((l, i) => (
                  <li key={i}>
                    {l.kind === 'removed'
                      ? `− ${l.text}`
                      : l.kind === 'added'
                        ? `+ ${l.text}`
                        : l.text}
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 text-fg-2">Saving marks this change reviewed.</div>
            </div>
          )}
          <Field label="Program">
            {(id) => (
              <TextInput
                id={id}
                value={draft.name}
                autoFocus={p.creating}
                invalid={nameMissing && dirty}
                placeholder="e.g. Mitacs Globalink"
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organization">
              {(id) => (
                <TextInput id={id} value={draft.org} onChange={(e) => set('org', e.target.value)} />
              )}
            </Field>
            <Field label="Status">
              {() => (
                <Select
                  size="md"
                  align="start"
                  label="Status"
                  value={draft.status}
                  options={STATUS_OPTIONS}
                  onChange={(v) => set('status', v)}
                />
              )}
            </Field>
          </div>
          <Field
            label="Official page"
            hint="Radar checks this page about once a day and flags changes."
          >
            {(id) => (
              <TextInput
                id={id}
                value={draft.url}
                invalid={urlBad}
                placeholder="https://"
                onChange={(e) => set('url', e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Dates">
              {() => (
                <Select
                  size="md"
                  align="start"
                  label="Dates"
                  value={draft.dates}
                  options={DATES_OPTIONS}
                  onChange={(v) => set('dates', v)}
                />
              )}
            </Field>
            <Field label="Window opens">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={draft.open}
                  onChange={(e) => set('open', e.target.value)}
                />
              )}
            </Field>
            <Field label="Deadline">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={draft.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="m-0 -mt-1.5 text-caption text-fg-3">
            Confirmed only when the official page says so. Reminders: 14 days before the window
            opens, and 30, 14, 7 and 2 days before the deadline.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Typical opening">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.typical_open}
                  placeholder="e.g. December"
                  onChange={(e) => set('typical_open', e.target.value)}
                />
              )}
            </Field>
            <Field label="Typical deadline">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.typical_deadline}
                  placeholder="e.g. February"
                  onChange={(e) => set('typical_deadline', e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Notes">
            {(id) => (
              <TextArea
                id={id}
                rows={4}
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            )}
          </Field>
          {!p.creating && p.item?.seeded && (
            <p className="m-0 text-caption text-fg-3">
              From the watchlist seed. Once you save a change here, your version is kept and the
              seed no longer updates it.
            </p>
          )}
        </div>
        <footer className="flex items-center gap-2 px-5 py-3.5 hairline-t border-line">
          {!p.creating && p.item && !p.item.seeded && (
            <Button
              variant="plain"
              icon={Trash2}
              className="text-red"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
          <span className="ml-auto" />
          <Button onClick={p.onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={nameMissing || urlBad || saving || (!p.creating && !dirty && !p.fromAlert)}
          >
            {p.creating ? 'Watch program' : p.fromAlert ? 'Save and mark reviewed' : 'Save'}
          </Button>
        </footer>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${p.item?.name ?? 'this program'}?`}
        message="The program, its watched page, alerts and reminders are removed. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          if (p.item) {
            void p.onDelete(p.item).then((ok) => {
              if (ok) p.onClose();
            });
          }
        }}
      />
    </Drawer>
  );
}
