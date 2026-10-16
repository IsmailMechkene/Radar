import { Plus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import type { TemplateInput, TemplateRow } from '../../../../shared/ipc';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { Icon } from '../../../components/Icon';
import { TextArea, TextInput } from '../../../components/Input';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Select } from '../../../components/Select';
import { COMMON_FIELDS } from '../../lib/outreach';

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote font-semibold text-fg-2">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

const EMPTY: TemplateInput = { name: '', kind: 'cold', subject: '', body: '' };
const NEW = 'new';

/** Edit email templates: name, kind, subject and body with [merge fields]. */
export function TemplatesDrawer({
  open,
  templates,
  initialId,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  templates: readonly TemplateRow[];
  initialId: number | null;
  onClose: () => void;
  onSave: (id: number | null, t: TemplateInput) => Promise<TemplateRow | null>;
  onDelete: (t: TemplateRow) => Promise<boolean>;
}) {
  const pick = (id: string) => {
    const t = templates.find((x) => String(x.id) === id);
    return t ? { name: t.name, kind: t.kind, subject: t.subject, body: t.body } : EMPTY;
  };
  const [selected, setSelected] = useState<string>(String(initialId ?? templates[0]?.id ?? NEW));
  const [draft, setDraft] = useState<TemplateInput>(() =>
    pick(String(initialId ?? templates[0]?.id ?? NEW)),
  );
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const current = templates.find((t) => String(t.id) === selected) ?? null;
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const ready = draft.name.trim() !== '' && draft.subject.trim() !== '' && draft.body.trim() !== '';

  function insert(field: string) {
    const el = bodyRef.current;
    const token = `[${field}]`;
    if (!el) return set('body', draft.body + token);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.body.slice(0, start) + token + draft.body.slice(end);
    set('body', next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <Drawer open={open} onClose={onClose} label="Templates">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || saving) return;
          setSaving(true);
          void onSave(current?.id ?? null, draft).then((saved) => {
            setSaving(false);
            if (saved) setSelected(String(saved.id));
          });
        }}
      >
        <header className="flex items-start gap-3 px-5 pt-5 pb-4 hairline-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-title-2 font-semibold tracking-title-2">Templates</h2>
            <div className="text-subhead text-fg-2">
              Write [field] where a value goes; it is filled per organization.
            </div>
          </div>
          <DrawerClose onClose={onClose} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg px-5 py-4.5">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Template">
                {() => (
                  <Select
                    size="md"
                    align="start"
                    label="Template"
                    value={selected}
                    options={[
                      ...templates.map((t) => ({ value: String(t.id), label: t.name })),
                      ...(selected === NEW ? [{ value: NEW, label: 'New template' }] : []),
                    ]}
                    onChange={(v) => {
                      setSelected(v);
                      setDraft(pick(v));
                    }}
                  />
                )}
              </Field>
            </div>
            <Button
              icon={Plus}
              onClick={() => {
                setSelected(NEW);
                setDraft(EMPTY);
              }}
            >
              New
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <Field label="Name">
              {(id) => (
                <TextInput
                  id={id}
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>
            <SegmentedControl
              label="Kind"
              value={draft.kind}
              onChange={(k) => set('kind', k)}
              segments={[
                { value: 'cold', label: 'First email' },
                { value: 'followup', label: 'Follow-up' },
              ]}
            />
          </div>
          <Field label="Subject">
            {(id) => (
              <TextInput
                id={id}
                value={draft.subject}
                onChange={(e) => set('subject', e.target.value)}
              />
            )}
          </Field>
          <Field label="Body">
            {(id) => (
              <TextArea
                ref={bodyRef}
                id={id}
                rows={14}
                value={draft.body}
                onChange={(e) => set('body', e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-footnote text-fg-3">Insert</span>
            {COMMON_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => insert(f)}
                className="focus-ring inline-flex h-5.5 items-center gap-1 rounded-xs bg-accent-soft px-2 text-caption font-medium text-accent-text hover:brightness-96"
              >
                <Icon icon={Plus} size={11} />
                {f}
              </button>
            ))}
          </div>
        </div>
        <footer className="flex items-center gap-2 px-5 py-3.5 hairline-t border-line">
          {current && (
            <Button
              variant="plain"
              icon={Trash2}
              className="text-red"
              onClick={() => setConfirm(true)}
            >
              Delete
            </Button>
          )}
          <span className="ml-auto" />
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary" disabled={!ready || saving}>
            {current ? 'Save template' : 'Add template'}
          </Button>
        </footer>
      </form>
      <ConfirmDialog
        open={confirm}
        title={`Delete "${current?.name ?? ''}"?`}
        message="Drafts that use it switch to another template. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          if (current) {
            void onDelete(current).then((ok) => {
              if (!ok) return;
              const next = templates.find((t) => t.id !== current.id);
              setSelected(String(next?.id ?? NEW));
              setDraft(
                next
                  ? { name: next.name, kind: next.kind, subject: next.subject, body: next.body }
                  : EMPTY,
              );
            });
          }
        }}
      />
    </Drawer>
  );
}
