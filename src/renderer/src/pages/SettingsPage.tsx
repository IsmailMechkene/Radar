import {
  BellRing,
  Briefcase,
  CircleDashed,
  Cpu,
  FileText,
  Globe,
  GraduationCap,
  House,
  MapPin,
  Moon,
  Power,
  Radar,
  RefreshCw,
  Sparkles,
  SunMoon,
  Terminal,
} from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Settings } from '../../../core/settings/schema';
import type { CopilotCheck } from '../../../shared/ipc';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { GroupedRow, GroupedSection } from '../../components/GroupedList';
import { TextArea, TextInput } from '../../components/Input';
import { Chip } from '../../components/Pill';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Select } from '../../components/Select';
import { Switch } from '../../components/Switch';
import { useToast } from '../../components/Toast';
import { checkLine, cvLine } from '../lib/copilot';
import {
  addListItem,
  cleanIpcError,
  isHhmm,
  REMOTE_PREFERENCE_LABELS,
  removeListItem,
  scanIntervalLabel,
  scanIntervalOptions,
  timezoneLabel,
  timezoneList,
} from '../lib/settings-helpers';
import { useSettings } from '../state/settings';
import { AccountSection } from './AccountSection';
import { DataSection } from './DataSection';
import { PageTitle } from './PageTitle';

const MATCH_ALERT_OPTIONS: { value: Settings['matchAlerts']; label: string }[] = [
  { value: 'apply', label: 'Strong matches (Apply)' },
  { value: 'apply_maybe', label: 'Apply and Maybe' },
  { value: 'daily', label: 'Daily summary at 09:00' },
  { value: 'off', label: 'Off' },
];

/** Text field that saves on Enter or blur, not on every keystroke. */
function CommitInput({
  value,
  onCommit,
  validate,
  label,
  className,
  placeholder,
  clearOnCommit,
}: {
  value: string;
  onCommit: (v: string) => Promise<boolean> | void;
  validate?: (v: string) => boolean;
  label: string;
  className?: string;
  placeholder?: string;
  clearOnCommit?: boolean;
}) {
  // null = not editing: show the stored value, so outside changes (Undo) appear immediately.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const invalid = validate ? shown !== '' && !validate(shown) : false;

  async function commit() {
    if (draft === null || draft === value || (clearOnCommit && !draft.trim()) || invalid) {
      if (!invalid) setDraft(null);
      return;
    }
    const ok = await onCommit(draft);
    if (ok !== false) setDraft(null);
  }

  return (
    <TextInput
      size="sm"
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      invalid={invalid}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      className={className}
    />
  );
}

/** Chip list with an inline "Add" field. The last item cannot be removed when `min` is 1. */
function ListEditor({
  items,
  onChange,
  noun,
  min = 0,
}: {
  items: string[];
  onChange: (next: string[]) => Promise<boolean>;
  noun: string;
  min?: number;
}) {
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <Chip
          key={item}
          label={item}
          removeDisabled={items.length <= min}
          onRemove={() => void onChange(removeListItem(items, item))}
        />
      ))}
      <CommitInput
        value=""
        clearOnCommit
        label={`Add ${noun}`}
        placeholder={`Add ${noun}…`}
        className="w-36"
        onCommit={(raw) => {
          const next = addListItem(items, raw);
          if (next.length === items.length) {
            toast({ tone: 'error', message: `“${raw.trim()}” is already in the list` });
            return Promise.resolve(false);
          }
          return onChange(next);
        }}
      />
    </div>
  );
}

const SEARCH_MODES = [
  { value: 'internships', label: 'Internships only' },
  { value: 'all', label: 'All roles' },
] as const;

const COPILOT_MODELS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
] as const;

/** Settings > Radar Copilot: the switch, where Claude Code is, the model, and the master CV. */
function CopilotSection({
  settings,
  set,
}: {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<boolean>;
}) {
  const toast = useToast();
  const [check, setCheck] = useState<CopilotCheck | null>(null);
  const [checking, setChecking] = useState(false);
  // null = not editing: show the stored CV.
  const [cvDraft, setCvDraft] = useState<string | null>(null);
  const copilot = settings.copilot;

  async function runCheck() {
    setChecking(true);
    try {
      const result = await window.radar.copilot.check();
      setCheck(result);
      toast(
        result.ok
          ? { message: 'Claude Code is ready' }
          : { tone: 'error', message: `Claude Code: ${checkLine(result)}` },
      );
    } catch (err) {
      console.error('[copilot] check failed', err);
      toast({ tone: 'error', message: `Check failed: ${cleanIpcError(err)}` });
    } finally {
      setChecking(false);
    }
  }

  async function commitCv() {
    if (cvDraft === null || cvDraft === settings.masterCv) {
      setCvDraft(null);
      return;
    }
    if (await set('masterCv', cvDraft)) setCvDraft(null);
  }

  return (
    <GroupedSection title="Radar Copilot">
      <GroupedRow
        icon={Sparkles}
        tile="indigo"
        title="Radar Copilot"
        description="Reviews, tailored CVs and cover letters by your own Claude Code. Off: Radar uses no AI."
      >
        <Switch
          label="Radar Copilot"
          checked={copilot.enabled}
          onChange={(enabled) =>
            void set('copilot', { ...copilot, enabled }).then((ok) => {
              if (ok && enabled && !check?.ok) void runCheck();
            })
          }
        />
      </GroupedRow>
      <GroupedRow
        icon={Terminal}
        tile="gray"
        title="Claude Code"
        description={
          checking
            ? 'Checking… (one tiny request)'
            : check
              ? checkLine(check)
              : 'Found on PATH unless you set a path'
        }
      >
        {check && !checking && (
          <Badge tone={check.ok ? 'green' : 'red'}>{check.ok ? 'Ready' : 'Problem'}</Badge>
        )}
        <CommitInput
          label="Path to claude"
          value={copilot.claudePath ?? ''}
          placeholder="Automatic"
          className="w-40"
          onCommit={(v) => set('copilot', { ...copilot, claudePath: v.trim() || null })}
        />
        <Button size="sm" disabled={checking} onClick={() => void runCheck()}>
          Check
        </Button>
      </GroupedRow>
      <GroupedRow
        icon={Cpu}
        tile="blue"
        title="Model"
        description="Sonnet is faster and uses less of your plan; Opus writes better"
      >
        <SegmentedControl
          label="Model"
          value={copilot.model}
          segments={COPILOT_MODELS}
          onChange={(model) => void set('copilot', { ...copilot, model })}
        />
      </GroupedRow>
      <GroupedRow
        icon={FileText}
        tile="teal"
        title="Master CV"
        description={cvLine(cvDraft ?? settings.masterCv)}
        below={
          <TextArea
            aria-label="Master CV"
            value={cvDraft ?? settings.masterCv}
            placeholder="Paste your CV here (plain text or Markdown)"
            className="min-h-40 w-full"
            onChange={(e) => setCvDraft(e.target.value)}
            onBlur={() => void commitCv()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCvDraft(null);
            }}
          />
        }
      />
    </GroupedSection>
  );
}

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export function SettingsPage({ isPackaged }: { isPackaged: boolean }) {
  const { settings, loadError, update } = useSettings();
  const toast = useToast();
  const now = useMemo(() => new Date(), []);

  const timezoneOptions = useMemo(
    () =>
      settings
        ? timezoneList(settings.timezone).map((tz) => ({
            value: tz,
            label: timezoneLabel(tz, now),
          }))
        : [],
    [settings?.timezone, now], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (loadError) {
    return (
      <div className="mx-auto max-w-(--content-max-settings)">
        <PageTitle title="Settings" />
        <div className="mt-5.5">
          <Banner title="Settings could not be loaded." description={loadError} />
        </div>
      </div>
    );
  }
  if (!settings) return null;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update(key, value);
  const intervals = scanIntervalOptions(settings.scanIntervalHours).map((h) => ({
    value: String(h),
    label: scanIntervalLabel(h),
  }));
  const remoteOptions = Object.entries(REMOTE_PREFERENCE_LABELS).map(([value, label]) => ({
    value: value as Settings['remotePreference'],
    label,
  }));

  const setQuietTime = (which: 'start' | 'end') => (v: string) => {
    if (!isHhmm(v)) {
      toast({ tone: 'error', message: 'Use 24-hour time, for example 22:00' });
      return Promise.resolve(false);
    }
    return set('quietHours', { ...settings.quietHours, [which]: v });
  };

  return (
    <div className="mx-auto max-w-(--content-max-settings)">
      <div className="mb-5.5">
        <PageTitle title="Settings" />
      </div>

      <AccountSection />

      <GroupedSection title="Search">
        <GroupedRow
          icon={Radar}
          tile="blue"
          title="Search mode"
          description="Which postings count as a match"
        >
          <SegmentedControl
            label="Search mode"
            value={settings.searchMode}
            segments={SEARCH_MODES}
            onChange={(v) => void set('searchMode', v)}
          />
        </GroupedRow>
        <GroupedRow
          icon={Briefcase}
          tile="sky"
          title="Roles of interest"
          description="Used to score titles"
          below={
            <ListEditor
              items={settings.rolesOfInterest}
              noun="role"
              min={1}
              onChange={(v) => set('rolesOfInterest', v)}
            />
          }
        />
        <GroupedRow
          icon={MapPin}
          tile="teal"
          title="Target regions"
          description="Where you want to work"
          below={
            <ListEditor
              items={settings.targetRegions}
              noun="region"
              onChange={(v) => set('targetRegions', v)}
            />
          }
        />
        <GroupedRow icon={House} tile="green" title="Remote preference">
          <Select
            label="Remote preference"
            value={settings.remotePreference}
            options={remoteOptions}
            onChange={(v) => void set('remotePreference', v)}
          />
        </GroupedRow>
      </GroupedSection>

      <GroupedSection title="Profile">
        <GroupedRow
          icon={GraduationCap}
          tile="gray"
          title="Grade"
          description="Stored exactly as written, never converted to another scale"
        >
          <Badge tone="expected" strong icon={CircleDashed}>
            Unverified
          </Badge>
          <CommitInput
            label="Grade"
            value={settings.grade.raw}
            className="w-20 text-center"
            validate={(v) => v.trim().length > 0}
            onCommit={(v) => set('grade', { raw: v.trim(), unverified: true })}
          />
        </GroupedRow>
      </GroupedSection>

      <CopilotSection settings={settings} set={set} />

      <GroupedSection title="Notifications">
        <GroupedRow
          icon={BellRing}
          tile="red"
          title="New-match alerts"
          description="After a scan, one notification for new postings you should look at"
        >
          <Select
            label="New-match alerts"
            value={settings.matchAlerts}
            options={MATCH_ALERT_OPTIONS}
            onChange={(v) => void set('matchAlerts', v)}
          />
        </GroupedRow>
        <GroupedRow
          icon={Moon}
          tile="indigo"
          title="Quiet hours"
          description="Hold notifications during these hours"
        >
          <div className="flex items-center gap-1.5 text-subhead text-fg-2">
            <CommitInput
              label="Quiet hours start"
              value={settings.quietHours.start}
              validate={isHhmm}
              className="w-14 text-center"
              onCommit={setQuietTime('start')}
            />
            to
            <CommitInput
              label="Quiet hours end"
              value={settings.quietHours.end}
              validate={isHhmm}
              className="w-14 text-center"
              onCommit={setQuietTime('end')}
            />
          </div>
          <Switch
            label="Quiet hours"
            checked={settings.quietHours.enabled}
            onChange={(enabled) => void set('quietHours', { ...settings.quietHours, enabled })}
          />
        </GroupedRow>
      </GroupedSection>

      <GroupedSection title="General">
        <GroupedRow
          icon={Power}
          tile="gray"
          title="Launch at login"
          description={
            isPackaged
              ? 'Start Radar in the tray when you sign in'
              : 'Start Radar in the tray when you sign in. Not applied in development builds.'
          }
        >
          <Switch
            label="Launch at login"
            checked={settings.autostart}
            onChange={(v) => void set('autostart', v)}
          />
        </GroupedRow>
        <GroupedRow icon={Globe} tile="blue" title="Timezone" description="Used for reminders">
          <Select
            label="Timezone"
            filterable
            value={settings.timezone}
            options={timezoneOptions}
            onChange={(v) => void set('timezone', v)}
          />
        </GroupedRow>
        <GroupedRow
          icon={RefreshCw}
          tile="teal"
          title="Scan interval"
          description="How often sources are checked"
        >
          <Select
            label="Scan interval"
            value={String(settings.scanIntervalHours)}
            options={intervals}
            onChange={(v) => void set('scanIntervalHours', Number(v))}
          />
        </GroupedRow>
        <GroupedRow icon={SunMoon} tile="indigo" title="Appearance">
          <SegmentedControl
            label="Appearance"
            value={settings.theme}
            segments={THEMES}
            onChange={(v) => void set('theme', v)}
          />
        </GroupedRow>
      </GroupedSection>

      <DataSection timeZone={settings.timezone} />
    </div>
  );
}
