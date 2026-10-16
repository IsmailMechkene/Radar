// Dev-only gallery of every component and token, in light and dark side by side.
// Mirrors the design's "components" screen. Not reachable in packaged builds.
import {
  ArchiveX,
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  Copy,
  ExternalLink,
  Globe,
  LayoutGrid,
  List,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Radar as RadarIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, CountBadge, StatusDot, VerdictBadge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Drawer, DrawerClose } from '../../components/Drawer';
import { GroupedRow, GroupedSection } from '../../components/GroupedList';
import { Kbd, SearchField, TextInput } from '../../components/Input';
import { FilterPill, Chip, MetaChip, Tag } from '../../components/Pill';
import { Menu, type MenuItemDef } from '../../components/Popover';
import { ScoreRing } from '../../components/ScoreRing';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Select } from '../../components/Select';
import { SidebarItem } from '../../components/SidebarItem';
import { Switch } from '../../components/Switch';
import { RowTitle, TableRow } from '../../components/TableRow';
import { ToastView } from '../../components/Toast';
import { Toolbar, ToolbarButton, ToolbarTitle } from '../../components/Toolbar';
import type { ResolvedTheme } from '../../../shared/theme';
import { ScanPill } from '../shell/ScanStatus';

const TOKENS: [string, string][] = [
  ['Background', '--bg'],
  ['Surface', '--sf'],
  ['Fill', '--fl'],
  ['Fill strong', '--fl2'],
  ['Hairline', '--ln'],
  ['Text', '--tx'],
  ['Text secondary', '--tx2'],
  ['Text tertiary', '--tx3'],
  ['Accent', '--ac'],
  ['Accent soft', '--acs'],
  ['Green · strong match', '--grf'],
  ['Amber · maybe, soon', '--amf'],
  ['Red · overdue, broken', '--rdf'],
  ['Gray · skip', '--gyf'],
  ['Sidebar vibrancy', '--sb'],
  ['Glass', '--gl'],
];

const TYPE_SCALE: { spec: string; sample: string; cls: string }[] = [
  {
    spec: '34 / 600 / −0.03',
    sample: 'Large title',
    cls: 'text-large-title font-semibold tracking-large-title',
  },
  {
    spec: '30 / 600 / −0.025',
    sample: 'Opportunities',
    cls: 'text-title-1 font-semibold tracking-title-1',
  },
  {
    spec: '22 / 600 / −0.02',
    sample: 'Drawer title',
    cls: 'text-title-2 font-semibold tracking-title-2',
  },
  {
    spec: '17 / 600 / −0.01',
    sample: 'Section title',
    cls: 'text-title-3 font-semibold tracking-title-3',
  },
  { spec: '14 / 600', sample: 'Card headline', cls: 'text-headline font-semibold' },
  { spec: '13 / 400', sample: 'Body text for rows and settings', cls: 'text-body' },
  { spec: '12 / 400 · secondary', sample: 'Hugging Face · Paris', cls: 'text-footnote text-fg-2' },
  {
    spec: '12 / 400 · tertiary',
    sample: 'AI/ML title, internship, remote, visa friendly',
    cls: 'text-footnote text-fg-3',
  },
  {
    spec: '11 / 600 / +0.06 caps',
    sample: 'New since your last visit',
    cls: 'text-caption-2 font-semibold tracking-caps uppercase text-fg-3',
  },
];

const SPACING = [
  'w-1 h-1',
  'w-2 h-2',
  'w-3 h-3',
  'w-4 h-4',
  'w-5 h-5',
  'w-6 h-6',
  'w-8 h-8',
  'w-10 h-10',
  'w-12 h-12',
];
const SPACING_PX = [4, 8, 12, 16, 20, 24, 32, 40, 48];
const RADII: [string, string][] = [
  ['rounded-xs', '6'],
  ['rounded-sm', '7 · buttons'],
  ['rounded-lg', '10'],
  ['rounded-2xl', '14 · cards'],
  ['rounded-3xl', '16'],
  ['rounded-full', 'pill'],
];

const ROW_COLUMNS = '16px 32px minmax(0,1fr) 100px 90px 72px';
const ROWS = [
  {
    t: 'Machine Learning Engineer Intern (Summer 2027)',
    lead: 'Hugging Face',
    why: 'AI/ML title, internship, remote, visa friendly',
    s: 92,
    state: 'Default',
  },
  {
    t: 'Full-Stack Intern, Remote EMEA',
    lead: 'DeepL',
    why: 'Full-stack title, internship, remote',
    s: 64,
    state: 'Hover',
  },
  {
    t: 'Data Engineer Intern',
    lead: 'Entrelacs',
    why: 'Data title, internship',
    s: 44,
    state: 'Selected',
  },
];

const noop = () => {};
const MENU: MenuItemDef[] = [
  { id: 'star', label: 'Star', icon: Star, shortcut: 'S', onSelect: noop },
  { id: 'dismiss', label: 'Dismiss', icon: ArchiveX, shortcut: 'X', onSelect: noop },
  { id: 'pipe', label: 'Add to pipeline', icon: Plus, shortcut: 'P', onSelect: noop },
  {
    id: 'copy',
    label: 'Copy for deep review',
    icon: Copy,
    shortcut: 'C',
    separatorBefore: true,
    onSelect: noop,
  },
  { id: 'open', label: 'Open apply link', icon: ExternalLink, shortcut: 'O', onSelect: noop },
  {
    id: 'delete',
    label: 'Delete permanently',
    icon: Trash2,
    shortcut: 'Ctrl ⌫',
    destructive: true,
    separatorBefore: true,
    onSelect: noop,
  },
];

const MOTION: [string, string, string][] = [
  ['Default transition', 'Hover, color, layout', '200 ms ease-out'],
  ['Row hover lift', 'Background fade, cards rise 2 px', '220 ms ease-out'],
  ['Drawer', 'Slides in from right', '300 ms ease-drawer'],
  ['Popovers, menus', 'Scale 0.96 → 1 from anchor, fade', '180 ms ease-pop'],
  ['Score ring', 'Number counts up from 0', '600 ms ease-out'],
  ['Switch knob', 'Spring, overshoot 1.4', '250 ms ease-spring'],
  ['Toast', 'Rises 8 px and fades, auto-dismiss', '250 ms · 2.8 s'],
];

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3.5 rounded-3xl bg-surface hairline border-line px-5.5 py-5 shadow-card ${className ?? ''}`}
    >
      <div className="text-body font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Swatches() {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    if (!ref.current) return;
    const cs = getComputedStyle(ref.current);
    setValues(Object.fromEntries(TOKENS.map(([, k]) => [k, cs.getPropertyValue(k).trim()])));
  }, []);
  return (
    <div ref={ref} className="grid grid-cols-8 gap-3">
      {TOKENS.map(([name, k]) => (
        <div key={k} className="overflow-hidden rounded-xl bg-surface hairline border-line">
          <div className="h-14 hairline-b border-line" style={{ background: `var(${k})` }} />
          <div className="px-2.5 py-2">
            <div className="text-footnote font-semibold">{name}</div>
            <div className="truncate font-mono text-micro text-fg-3">{k}</div>
            <div className="truncate font-mono text-micro text-fg-2">{values[k]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Gallery({ theme }: { theme: ResolvedTheme }) {
  const [sw, setSw] = useState({ a: true, b: false });
  const [seg, setSeg] = useState<'list' | 'month'>('month');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [checked, setChecked] = useState(true);
  const [tz, setTz] = useState('Africa/Tunis');
  const [drawer, setDrawer] = useState(false);

  return (
    <div
      data-theme={theme}
      className="relative flex flex-col gap-8 overflow-hidden rounded-3xl bg-bg p-8 text-fg hairline border-line"
    >
      <div>
        <div className="text-caption-2 font-semibold tracking-eyebrow text-fg-3 uppercase">
          Radar · {theme === 'dark' ? 'Dark' : 'Light'}
        </div>
        <div className="mt-1 text-large-title font-semibold tracking-large-title">
          Design system
        </div>
      </div>

      <div>
        <div className="mb-3 text-body font-semibold">Color tokens</div>
        <Swatches />
      </div>

      <div className="grid grid-cols-[1.1fr_1fr] gap-6">
        <Card title="Type scale">
          <div>
            {TYPE_SCALE.map((t) => (
              <div
                key={t.spec}
                className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-4 hairline-t border-line py-2.25"
              >
                <span className="font-mono text-caption-2 text-fg-3">{t.spec}</span>
                <span className={`truncate leading-[1.2] ${t.cls}`}>{t.sample}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Spacing · 4 px base">
            <div className="flex items-end gap-3.5">
              {SPACING.map((cls, i) => (
                <div key={cls} className="flex flex-col items-center gap-1.5">
                  <div className={`${cls} rounded-[2px] bg-accent-soft hairline border-accent`} />
                  <span className="text-caption-2 text-fg-2 tabular-nums">{SPACING_PX[i]}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Radius">
            <div className="flex gap-4">
              {RADII.map(([cls, label]) => (
                <div key={cls} className="flex flex-col items-center gap-1.5">
                  <div className={`size-14 bg-fill hairline border-line-2 ${cls}`} />
                  <span className="text-caption-2 text-fg-2">{label}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Shadow">
            <div className="flex gap-5 pt-1 pb-2">
              <div className="grid h-16 flex-1 place-items-center rounded-xl bg-surface hairline border-line text-caption text-fg-2">
                0 · hairline only
              </div>
              <div className="grid h-16 flex-1 place-items-center rounded-xl bg-surface text-caption text-fg-2 shadow-card">
                1 · cards
              </div>
              <div className="grid h-16 flex-1 place-items-center rounded-xl bg-surface text-caption text-fg-2 shadow-pop">
                2 · popovers, drawers
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Card title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="plain">Plain</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button iconOnly icon={Star} aria-label="Star" />
            <Button size="sm">Small</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" className="shadow-focus-strong">
              Focused
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" iconRight={ArrowUpRight} className="shadow-primary">
              Apply
            </Button>
            <Button size="lg" icon={Plus}>
              Add to pipeline
            </Button>
          </div>
          <div className="text-caption text-fg-3">
            Height 28 (24 small, 30 drawer). Radius 7. Hover darkens 4%, press scales 0.98.
          </div>
        </Card>

        <Card title="Pills and chips">
          <div className="flex flex-wrap gap-1.5">
            <FilterPill label="Country" />
            <FilterPill label="Score ≥ 60" active />
            <Chip label="machine learning" onRemove={noop} />
            <Chip label="senior" tone="danger" onRemove={noop} />
            <Tag label="[first name]" />
            <MetaChip label="Remote" icon={Globe} />
          </div>
          <div className="flex flex-wrap items-center gap-3.5">
            <SegmentedControl
              label="View"
              value={seg}
              onChange={setSeg}
              segments={[
                { value: 'list', label: 'List' },
                { value: 'month', label: 'Month' },
              ]}
            />
            <SegmentedControl
              label="Layout"
              iconOnly
              value={view}
              onChange={setView}
              segments={[
                { value: 'list', label: 'List', icon: List },
                { value: 'grid', label: 'Grid', icon: LayoutGrid },
              ]}
            />
            <Switch label="Demo A" checked={sw.a} onChange={(a) => setSw({ ...sw, a })} />
            <Switch label="Demo B" checked={sw.b} onChange={(b) => setSw({ ...sw, b })} />
            <Switch label="Disabled" checked disabled onChange={noop} />
            <Checkbox label="Checked" checked={checked} onChange={setChecked} />
            <Checkbox label="Unchecked" checked={false} onChange={noop} />
          </div>
          <div className="text-caption text-fg-3">
            Switch knob uses a spring (overshoot 1.4), 250 ms.
          </div>
        </Card>

        <Card title="Inputs">
          <SearchField aria-label="Search" placeholder="Search" shortcut="Ctrl K" />
          <TextInput aria-label="Name" defaultValue="Yasmine Ben Ali" />
          <TextInput
            aria-label="Focused"
            defaultValue="Focused field"
            className="border border-accent shadow-focus"
          />
          <div className="flex gap-2">
            <Select
              label="Timezone"
              size="md"
              filterable
              align="start"
              className="flex-1"
              value={tz}
              onChange={setTz}
              options={['Africa/Tunis', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'UTC'].map(
                (v) => ({ value: v, label: v }),
              )}
            />
            <TextInput aria-label="Invalid" invalid defaultValue="Invalid URL" className="flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <TextInput
              size="sm"
              aria-label="Compact"
              defaultValue="22:00"
              className="w-14 text-center"
            />
            <Kbd>Ctrl K</Kbd>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] gap-6">
        <Card title="Score ring and badges">
          <div className="flex items-center gap-4.5">
            <ScoreRing score={92} size="xl" animate />
            <ScoreRing score={74} size="lg" animate />
            <ScoreRing score={55} size="md" animate />
            <ScoreRing score={38} size="sm" animate />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <VerdictBadge verdict="apply" />
            <VerdictBadge verdict="maybe" />
            <VerdictBadge verdict="needs_review" />
            <VerdictBadge verdict="skip" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="amber">9 days left</Badge>
            <Badge tone="red">Overdue</Badge>
            <Badge tone="neutral" dashed>
              ~ Dec 15
            </Badge>
            <Badge tone="outline">No deadline</Badge>
            <Badge tone="green" strong icon={CircleCheck}>
              Confirmed
            </Badge>
            <Badge tone="expected" strong icon={CircleDashed}>
              Expected, unconfirmed
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3.5 text-footnote text-fg-2">
            <span className="flex items-center gap-1.5">
              <StatusDot tone="healthy" />
              Healthy
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="slow" />
              Slow
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="broken" />
              Broken
            </span>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="paused" />
              Paused
            </span>
            <CountBadge tone="accent">12 new</CountBadge>
            <CountBadge tone="amber">3 due</CountBadge>
            <CountBadge tone="red">1</CountBadge>
            <CountBadge tone="gray">1</CountBadge>
          </div>
        </Card>

        <div className="overflow-hidden rounded-3xl bg-surface hairline border-line pt-5 shadow-card">
          <div className="px-5.5 pb-3 text-body font-semibold">Table rows · 56 px</div>
          <div role="table" aria-label="Sample rows">
            {ROWS.map((r, i) => (
              <TableRow key={r.t} columns={ROW_COLUMNS} hovered={i === 1} selected={i === 2}>
                <Checkbox label={`Select ${r.t}`} checked={i === 2} onChange={noop} />
                <ScoreRing score={r.s} />
                <RowTitle title={r.t} lead={r.lead} detail={r.why} />
                {i === 0 ? (
                  <Badge tone="amber">9 days left</Badge>
                ) : i === 1 ? (
                  <Badge tone="neutral" dashed>
                    ~ Dec 15
                  </Badge>
                ) : (
                  <Badge tone="outline">No deadline</Badge>
                )}
                <VerdictBadge verdict={i === 0 ? 'apply' : i === 1 ? 'maybe' : 'skip'} />
                <span className="text-right text-caption-2 text-fg-3">{r.state}</span>
              </TableRow>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[260px_1fr_300px] items-start gap-6">
        <div>
          <div className="mb-3 text-body font-semibold">Popover menu</div>
          <div className="w-max rounded-xl bg-glass backdrop-glass hairline border-glass-border p-1.25 shadow-pop">
            <Menu label="Row actions" items={MENU} initialActive={2} />
          </div>
        </div>
        <div>
          <div className="mb-3 text-body font-semibold">Motion</div>
          <div className="rounded-3xl bg-surface hairline border-line shadow-card">
            {MOTION.map(([l, d, t]) => (
              <div
                key={l}
                className="grid min-h-10 grid-cols-[150px_minmax(0,1fr)_140px] items-center gap-3 px-4.5 py-1.5 text-subhead not-first:hairline-t border-line"
              >
                <span className="font-medium">{l}</span>
                <span className="text-fg-2">{d}</span>
                <span className="text-right font-mono text-caption-2 text-fg-3">{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="text-body font-semibold">Toast</div>
          <ToastView message="Added to Pipeline" action={{ label: 'Undo', onAction: noop }} />
          <ToastView tone="error" message="Not saved: unknown IANA time zone" />
          <div className="mt-2 text-body font-semibold">Banner</div>
          <Banner title="Returned nothing for 3 runs." />
          <Banner tone="warning" title="Page changed, review" />
        </div>
      </div>

      <div className="grid grid-cols-[260px_1fr] items-start gap-6">
        <div>
          <div className="mb-3 text-body font-semibold">Sidebar items</div>
          <div className="flex flex-col gap-px rounded-xl bg-sidebar p-2.5 hairline border-line">
            <SidebarItem
              href="#"
              label="Opportunities"
              icon={RadarIcon}
              active
              badge={{ text: '12 new', tone: 'accent' }}
              onNavigate={noop}
            />
            <SidebarItem
              href="#"
              label="Programs"
              icon={Moon}
              badge={{ text: '1', tone: 'gray' }}
              onNavigate={noop}
            />
            <SidebarItem href="#" label="Settings" icon={SettingsIcon} onNavigate={noop} />
          </div>
        </div>
        <div>
          <div className="mb-3 text-body font-semibold">Toolbar, grouped list, drawer</div>
          <div className="overflow-hidden rounded-xl bg-bg hairline border-line">
            <Toolbar>
              <ToolbarTitle>Opportunities</ToolbarTitle>
              <SearchField
                aria-label="Search"
                placeholder="Search roles, companies, sources"
                shortcut="Ctrl K"
                className="ml-auto max-w-(--search-max) flex-1"
              />
              <ScanPill />
              <ToolbarButton icon={Moon} label="Theme" />
            </Toolbar>
          </div>
          <div className="mt-4">
            <GroupedSection title="General">
              <GroupedRow
                icon={Globe}
                tile="blue"
                title="Timezone"
                description="Used for reminders"
              >
                <Button size="sm" onClick={() => setDrawer(true)}>
                  Open drawer
                </Button>
              </GroupedRow>
            </GroupedSection>
          </div>
        </div>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} label="Sample drawer">
        <div className="hairline-b border-line px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="text-body font-semibold">Hugging Face</div>
            <div className="ml-auto">
              <DrawerClose onClose={() => setDrawer(false)} />
            </div>
          </div>
          <h2 className="mt-3.5 text-title-2 font-semibold tracking-title-2">
            Machine Learning Engineer Intern (Summer 2027)
          </h2>
          <div className="mt-4 flex gap-1.5">
            <Button variant="primary" size="lg" iconRight={ArrowUpRight} className="shadow-primary">
              Apply
            </Button>
            <Button size="lg" icon={Plus}>
              Add to pipeline
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4 p-6">
          <ScoreRing score={92} size="xl" animate />
          <div className="text-body text-fg-2">Score breakdown goes here.</div>
        </div>
      </Drawer>
    </div>
  );
}

export function ComponentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-title-1 font-semibold tracking-title-1">Components</h1>
        <div className="mt-1.5 text-body text-fg-2">
          Dev only. Every component from DESIGN.md in light and dark.
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <Gallery theme="light" />
        <Gallery theme="dark" />
      </div>
    </div>
  );
}
