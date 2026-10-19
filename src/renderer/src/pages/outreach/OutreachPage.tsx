import {
  Copy,
  FileText,
  Kanban,
  Mail,
  Search,
  ShieldCheck,
  TriangleAlert,
  RotateCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OutreachItem, TemplateInput, TemplateRow } from '../../../../shared/ipc';
import { Banner } from '../../../components/Banner';
import { OrgAvatar } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { TextInput } from '../../../components/Input';
import { Tag } from '../../../components/Pill';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Select } from '../../../components/Select';
import { Skeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { cn } from '../../../components/lib/cn';
import { notifyDataChanged } from '../../lib/data-events';
import { monogram, monogramHue } from '../../lib/opportunities';
import {
  alreadyEmailed,
  draftFields,
  isSharedField,
  orgStatus,
  parts,
  render,
  templateFor,
  valuesFor,
  type Part,
} from '../../lib/outreach';
import { roleOf } from '../../lib/pipeline';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { TemplatesDrawer } from './TemplatesDrawer';
import { useSyncVersion } from '../../state/sync-version';

type Mode = 'fields' | 'preview';

function Rendered({ list }: { list: Part[] }) {
  return (
    <>
      {list.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : p.value ? (
          <span key={i}>{p.value}</span>
        ) : (
          <Tag key={i} label={p.name} />
        ),
      )}
    </>
  );
}

const FIELD_LABEL: Record<string, string> = { email: 'To (email)' };

export function OutreachPage() {
  const { settings, update } = useSettings();
  const tz = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shared = useMemo(() => settings?.outreachDefaults ?? {}, [settings]);
  const toast = useToast();
  const [items, setItems] = useState<OutreachItem[] | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<Mode>('fields');
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const now = new Date();

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[outreach] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      Promise.all([window.radar.outreach.list(), window.radar.outreach.templates()]).then(
        ([list, tpl]) => {
          setItems(list);
          setTemplates(tpl);
          setError(null);
        },
        (err: unknown) => {
          console.error('[outreach] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  const synced = useSyncVersion();
  useEffect(() => {
    void reload();
  }, [reload, synced]);

  const visible = (items ?? []).filter((i) =>
    `${i.row.org} ${roleOf(i.row)}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const item = (items ?? []).find((i) => i.row.id === selectedId) ?? visible[0] ?? null;
  const template = item ? templateFor(item, templates) : null;
  const values = item ? { ...valuesFor(item, shared), ...editing } : {};
  const rendered = template ? render(template.subject, template.body, values) : null;
  const to = values['email']?.trim() ?? '';
  const warning = item ? alreadyEmailed(item, template, now, tz) : null;
  const followupTemplate = templates.find((t) => t.kind === 'followup');

  function select(id: number) {
    setSelectedId(id);
    setEditing({});
  }

  async function saveDraft(
    next: OutreachItem,
    templateId: number | null,
    fields: Record<string, string>,
  ) {
    try {
      await window.radar.outreach.saveDraft(next.row.id, { template_id: templateId, fields });
      setItems((list) =>
        (list ?? []).map((i) =>
          i.row.id === next.row.id ? { ...i, template_id: templateId, fields } : i,
        ),
      );
    } catch (err) {
      fail('Save draft', err);
    }
  }

  /** Commit one field on blur: shared fields go to Settings, others to this draft. */
  async function commitField(name: string) {
    if (!item || !(name in editing)) return;
    const value = editing[name]!.trim();
    setEditing(({ [name]: _gone, ...rest }) => rest);
    if (isSharedField(name)) {
      if ((shared[name] ?? '') === value) return;
      const next = { ...shared };
      if (value) next[name] = value;
      else delete next[name];
      await update('outreachDefaults', next, { toast: false });
      return;
    }
    if ((item.fields[name] ?? '') === value) return;
    const fields = { ...item.fields };
    if (value && value !== item.auto[name]) fields[name] = value;
    else delete fields[name];
    await saveDraft(item, template?.id ?? null, fields);
  }

  async function copy() {
    if (!rendered) return;
    try {
      await window.radar.app.copyText(`Subject: ${rendered.subject}\n\n${rendered.body}`);
      toast({ message: 'Draft copied to the clipboard' });
    } catch (err) {
      fail('Copy', err);
    }
  }

  async function openMail() {
    if (!rendered || !item) return;
    try {
      await window.radar.app.openMail(to, rendered.subject, rendered.body);
      const row = item.row;
      const canMark = row.status === 'not_started' || row.status === 'drafted';
      toast({
        message: 'Opened in your mail app as a draft',
        action: canMark
          ? {
              label: 'Mark sent',
              onAction: () =>
                void window.radar.pipeline.update(row.id, { status: 'sent' }).then(
                  () => {
                    notifyDataChanged();
                    void reload();
                    toast({ message: `${row.org} marked sent; follow-ups in 7 and 14 days` });
                  },
                  (err: unknown) => fail('Mark sent', err),
                ),
            }
          : undefined,
      });
    } catch (err) {
      fail('Open in Mail', err);
    }
  }

  async function saveTemplate(id: number | null, t: TemplateInput): Promise<TemplateRow | null> {
    try {
      const saved = await window.radar.outreach.saveTemplate(id, t);
      await reload();
      toast({ message: `Saved template "${saved.name}"` });
      return saved;
    } catch (err) {
      fail('Save template', err);
      return null;
    }
  }

  async function deleteTemplate(t: TemplateRow): Promise<boolean> {
    try {
      await window.radar.outreach.deleteTemplate(t.id);
      await reload();
      toast({ message: `Deleted template "${t.name}"` });
      return true;
    } catch (err) {
      fail('Delete template', err);
      return false;
    }
  }

  const fieldList = template ? draftFields(template) : [];
  const missing = rendered ? [...(to ? [] : ['email']), ...rendered.missing] : [];

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle
          title="Outreach"
          subtitle="Draft cold emails with merge fields. You send them yourself."
        />
        <Button icon={FileText} onClick={() => setTemplatesOpen(true)} disabled={items === null}>
          Templates
        </Button>
      </div>

      {error ? (
        <Banner
          title="Outreach could not be loaded."
          description={error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      ) : items === null ? (
        <Skeleton className="h-177.5 w-full rounded-3xl" />
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-3xl bg-surface px-6 py-14 text-center hairline border-line shadow-card">
          <Icon icon={Kanban} size={18} className="text-fg-3" />
          <div className="mt-2 text-headline font-semibold">No organizations yet</div>
          <p className="mt-1 max-w-110 text-subhead text-fg-2">
            Outreach drafts are written for the organizations in your Pipeline. Add them there first
            (Add entry or Import CSV).
          </p>
        </div>
      ) : (
        <div className="grid h-177.5 grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-3xl bg-surface hairline border-line shadow-card">
          <div className="flex min-h-0 flex-col bg-surface-2 hairline-r border-line">
            <div className="p-3">
              <label className="flex h-7 items-center gap-1.75 rounded-sm bg-fill px-2.25 text-subhead text-fg-3 focus-within:shadow-focus">
                <Icon icon={Search} size={13} />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter organizations"
                  aria-label="Filter organizations"
                  className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3"
                />
              </label>
            </div>
            <div
              role="listbox"
              aria-label="Organizations"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-2"
            >
              {visible.map((i) => {
                const t = templateFor(i, templates);
                const ready = t
                  ? render(t.subject, t.body, valuesFor(i, shared)).missing.length === 0
                  : false;
                const st = orgStatus(i, ready, now, tz);
                const active = item?.row.id === i.row.id;
                return (
                  <button
                    key={i.row.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => select(i.row.id)}
                    className={cn(
                      'focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2.25 text-left',
                      active ? 'bg-accent-soft' : 'hover:bg-fill',
                    )}
                  >
                    <OrgAvatar
                      initials={monogram(i.row.org)}
                      hue={monogramHue(i.row.org)}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-body font-semibold">{i.row.org}</span>
                        <span
                          className={cn(
                            'ml-auto shrink-0 text-caption-2 whitespace-nowrap',
                            st.tone === 'amber'
                              ? 'text-amber'
                              : st.tone === 'green'
                                ? 'text-green'
                                : 'text-fg-3',
                          )}
                        >
                          {st.label}
                        </span>
                      </div>
                      <div className="truncate text-footnote text-fg-2">{roleOf(i.row) || '—'}</div>
                    </div>
                  </button>
                );
              })}
              {visible.length === 0 && (
                <div className="px-2.5 py-4 text-subhead text-fg-3">No match.</div>
              )}
            </div>
          </div>

          {item && template && rendered ? (
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center gap-2.5 px-5 py-3.5 hairline-b border-line">
                <OrgAvatar
                  initials={monogram(item.row.org)}
                  hue={monogramHue(item.row.org)}
                  size="xs"
                />
                <h2 className="m-0 truncate text-callout font-semibold tracking-title-3">
                  {item.row.org}
                </h2>
                <div className="ml-2">
                  <Select
                    label="Template"
                    align="start"
                    value={String(template.id)}
                    options={templates.map((t) => ({
                      value: String(t.id),
                      label: `Template: ${t.name}`,
                    }))}
                    onChange={(v) => void saveDraft(item, Number(v), item.fields)}
                  />
                </div>
                <div className="ml-auto">
                  <SegmentedControl
                    label="View"
                    value={mode}
                    onChange={setMode}
                    segments={[
                      { value: 'fields', label: 'Fields' },
                      { value: 'preview', label: 'Preview' },
                    ]}
                  />
                </div>
              </div>

              {warning && (
                <div className="mx-5 mt-3.5 flex items-center gap-2.5 rounded-lg bg-amber-soft px-3 py-2.5 text-amber">
                  <Icon icon={TriangleAlert} size={16} />
                  <span className="text-body font-semibold">{warning.title}</span>
                  <span className="text-subhead text-fg-2">{warning.detail}</span>
                  {followupTemplate && (
                    <button
                      type="button"
                      onClick={() => void saveDraft(item, followupTemplate.id, item.fields)}
                      className="focus-ring ml-auto rounded-2xs text-subhead font-semibold whitespace-nowrap"
                    >
                      Write follow-up instead
                    </button>
                  )}
                </div>
              )}

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="flex flex-col gap-0 px-5 pt-3">
                  <div className="flex items-center gap-3 py-2 hairline-b border-line text-body">
                    <span className="w-14 text-fg-3">To</span>
                    {to ? <span>{to}</span> : <Tag label="email" />}
                  </div>
                  <div className="flex items-start gap-3 py-2 hairline-b border-line text-body">
                    <span className="w-14 shrink-0 text-fg-3">Subject</span>
                    <span className="font-medium">
                      <Rendered list={parts(template.subject, values)} />
                    </span>
                  </div>
                </div>

                {mode === 'preview' ? (
                  <div className="px-5 py-4 text-body leading-relaxed whitespace-pre-wrap">
                    <Rendered list={parts(template.body, values)} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                    {fieldList.map((name) => {
                      const known = item.auto[name];
                      const stored = isSharedField(name)
                        ? (shared[name] ?? '')
                        : (item.fields[name] ?? item.auto[name] ?? '');
                      const value = editing[name] ?? stored;
                      return (
                        <label key={name} className="flex flex-col gap-1.5">
                          <span className="text-footnote font-semibold text-fg-2">
                            {FIELD_LABEL[name] ?? name[0]!.toUpperCase() + name.slice(1)}
                            {isSharedField(name) && (
                              <span className="ml-1.5 font-normal text-fg-3">
                                · every organization
                              </span>
                            )}
                            {known && !item.fields[name] && (
                              <span className="ml-1.5 font-normal text-fg-3">· from Pipeline</span>
                            )}
                          </span>
                          <TextInput
                            value={value}
                            invalid={false}
                            placeholder={name === 'email' ? 'name@company.com' : ''}
                            onChange={(e) => setEditing((s) => ({ ...s, [name]: e.target.value }))}
                            onBlur={() => void commitField(name)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 px-5 py-3.5 hairline-t border-line">
                <Icon icon={ShieldCheck} size={16} className="shrink-0 text-green" />
                <span className="min-w-0 text-subhead text-fg-2">
                  {missing.length ? (
                    <>Fill {missing.map((m) => `[${m}]`).join(', ')} to copy or open it.</>
                  ) : (
                    <>
                      <b className="font-semibold text-fg">Radar never sends email for you.</b> Copy
                      the draft or open it in your mail app.
                    </>
                  )}
                </span>
                <Button
                  className="ml-auto"
                  icon={Copy}
                  disabled={rendered.missing.length > 0}
                  onClick={() => void copy()}
                >
                  Copy
                </Button>
                <Button
                  variant="primary"
                  icon={Mail}
                  disabled={missing.length > 0}
                  onClick={() => void openMail()}
                >
                  Open in Mail
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid place-items-center text-subhead text-fg-3">
              Pick an organization.
            </div>
          )}
        </div>
      )}

      <TemplatesDrawer
        key={templatesOpen ? 'open' : 'closed'}
        open={templatesOpen}
        templates={templates}
        initialId={template?.id ?? null}
        onClose={() => setTemplatesOpen(false)}
        onSave={saveTemplate}
        onDelete={deleteTemplate}
      />
    </div>
  );
}
