import { ArrowUpRight, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { PipelineItem, PipelineNew, PipelinePatch } from '../../../../shared/ipc';
import { OrgAvatar } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { TextArea, TextInput } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { monogram, monogramHue } from '../../lib/opportunities';
import {
  draftOf,
  EMPTY_DRAFT,
  followupChips,
  PIPELINE_STATUSES,
  patchOf,
  roleOf,
  STATUS_META,
  type PipelineDraft,
} from '../../lib/pipeline';
import { FollowupChips } from './PipelineTable';

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

const STATUS_OPTIONS = PIPELINE_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }));

interface Props {
  /** The row being edited; null with `creating` for a new entry. */
  item: PipelineItem | null;
  creating: boolean;
  now: Date;
  timeZone: string;
  onClose: () => void;
  onSave: (patch: PipelinePatch) => Promise<boolean>;
  onCreate: (row: PipelineNew) => Promise<boolean>;
  onDelete: (item: PipelineItem) => Promise<boolean>;
  onOpenLink: (url: string) => void;
}

/** Edit (or add) one pipeline entry. Saves only what changed. Give it a `key` per row. */
export function PipelineDrawer(p: Props) {
  const open = p.creating || p.item !== null;
  const before = p.item ? draftOf(p.item, p.timeZone) : EMPTY_DRAFT;
  const [draft, setDraft] = useState<PipelineDraft>(before);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof PipelineDraft>(k: K, v: PipelineDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const patch = patchOf(draft, before, p.timeZone);
  const dirty = Object.keys(patch).length > 0;
  const orgMissing = draft.org.trim() === '';

  async function submit() {
    if (orgMissing || saving) return;
    setSaving(true);
    const ok = p.creating ? await p.onCreate({ ...patch, org: draft.org }) : await p.onSave(patch);
    setSaving(false);
    if (ok) p.onClose();
  }

  const title = p.creating ? 'New entry' : (p.item?.org ?? '');
  const role = p.item ? roleOf(p.item) : '';
  return (
    <Drawer open={open} onClose={p.onClose} label={p.creating ? 'Add entry' : `Edit ${title}`}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 hairline-b border-line">
          {!p.creating && p.item && (
            <OrgAvatar initials={monogram(p.item.org)} hue={monogramHue(p.item.org)} size="md" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-title-2 font-semibold tracking-title-2">{title}</h2>
            {role && <div className="truncate text-subhead text-fg-2">{role}</div>}
          </div>
          <DrawerClose onClose={p.onClose} />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg px-5 py-4.5">
          {p.item?.opportunity_url && (
            <div className="flex items-center gap-2 text-subhead text-fg-2">
              From Opportunities:{' '}
              <span className="truncate font-medium text-fg">{p.item.opportunity_title}</span>
              <Button
                size="sm"
                variant="plain"
                icon={ArrowUpRight}
                onClick={() => p.onOpenLink(p.item!.opportunity_url!)}
              >
                Open posting
              </Button>
            </div>
          )}
          {p.item?.program_name && (
            <div className="text-subhead text-fg-2">
              Program: <span className="font-medium text-fg">{p.item.program_name}</span>
            </div>
          )}

          <Field label="Organization">
            {(id) => (
              <TextInput
                id={id}
                value={draft.org}
                invalid={orgMissing && dirty}
                autoFocus={p.creating}
                onChange={(e) => set('org', e.target.value)}
              />
            )}
          </Field>
          <Field label="Role">
            {(id) => (
              <TextInput
                id={id}
                value={draft.role}
                placeholder={
                  p.item?.opportunity_title ?? p.item?.program_name ?? 'e.g. ML Engineer Intern'
                }
                onChange={(e) => set('role', e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
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
            <Field label="Planned send">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={draft.planned}
                  onChange={(e) => set('planned', e.target.value)}
                />
              )}
            </Field>
            <Field label="Sent">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={draft.sent}
                  onChange={(e) => set('sent', e.target.value)}
                />
              )}
            </Field>
          </div>
          {p.item?.sent_at ? (
            <div className="flex items-center gap-2 text-footnote text-fg-2">
              Follow-ups
              <FollowupChips chips={followupChips(p.item, p.now, p.timeZone)} />
            </div>
          ) : (
            <div className="text-footnote text-fg-3">
              Marking it Sent starts follow-up reminders at +7 and +14 days.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.contact_name}
                  placeholder="Name or team"
                  onChange={(e) => set('contact_name', e.target.value)}
                />
              )}
            </Field>
            <Field label="Email or link">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.contact_url}
                  onChange={(e) => set('contact_url', e.target.value)}
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
        </div>

        <footer className="flex items-center gap-2 px-5 py-3.5 hairline-t border-line">
          {!p.creating && p.item && (
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
            disabled={orgMissing || saving || (!p.creating && !dirty)}
          >
            {p.creating ? 'Add entry' : 'Save'}
          </Button>
        </footer>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${p.item?.org ?? 'this entry'}?`}
        message="The entry and its follow-up reminders are removed. This cannot be undone."
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
