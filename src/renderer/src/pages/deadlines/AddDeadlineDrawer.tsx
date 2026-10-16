import { useId, useState, type ReactNode } from 'react';
import type { ManualDeadlineInput } from '../../../../shared/ipc';
import { Button } from '../../../components/Button';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { TextArea, TextInput } from '../../../components/Input';

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

/** Add a deadline by hand (an email from a school office, a form, ...). Reminded like a starred one. */
export function AddDeadlineDrawer({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: ManualDeadlineInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [org, setOrg] = useState('');
  const [date, setDate] = useState('');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const ready = title.trim() !== '' && date !== '';

  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    const ok = await onAdd({ title, org, date, url, notes });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} label="Add deadline">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 hairline-b border-line">
          <h2 className="m-0 flex-1 text-title-2 font-semibold tracking-title-2">Add deadline</h2>
          <DrawerClose onClose={onClose} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg px-5 py-4.5">
          <Field label="What is due">
            {(id) => (
              <TextInput
                id={id}
                autoFocus
                value={title}
                placeholder="e.g. Erasmus+ application file"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organization">
              {(id) => <TextInput id={id} value={org} onChange={(e) => setOrg(e.target.value)} />}
            </Field>
            <Field label="Date">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Link">
            {(id) => <TextInput id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
          <Field label="Notes">
            {(id) => (
              <TextArea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
          <p className="m-0 text-footnote text-fg-3">
            The deadline is the end of that day. Reminders come 30, 14, 7 and 2 days before and on
            the day.
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3.5 hairline-t border-line">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!ready || saving}>
            Add deadline
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}
