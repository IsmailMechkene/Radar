// Single source of truth for IPC between main, preload and renderer. No Electron imports here.
import { z } from 'zod';
import {
  pipelineNewSchema,
  pipelinePatchSchema,
  type AddToPipelineResult,
  type PipelineItem,
  type PipelineNew,
  type PipelinePatch,
  type PipelineStatus,
} from '../core/db/pipeline';
import type { ImportResult } from '../core/pipeline/import';
import {
  deadlineTargetSchema,
  manualDeadlineInputSchema,
  type DeadlineEvent,
  type DeadlinesView,
  type DueFollowup,
  type ManualDeadlineInput,
} from '../core/deadlines/list';
import {
  programNewSchema,
  programPatchSchema,
  type ProgramItem,
  type ProgramNew,
  type ProgramPatch,
  type ProgramStatus,
} from '../core/programs/manage';
import type { PageCheck } from '../core/watch/pages';
import type { NavCounts } from '../core/nav';
import type { RescoreResult } from '../core/rules/rescore';
import type { Rules } from '../core/rules/schema';
import type { PreviewItem } from '../core/rules/store';
import {
  draftInputSchema,
  templateInputSchema,
  type DraftInput,
  type OutreachItem,
  type TemplateInput,
  type TemplateRow,
} from '../core/outreach';
import {
  newSourceSchema,
  type NewSource,
  type SourceHealth,
  type SourceItem,
  type TestResult,
} from '../core/sources/manage';
import type { RunRow } from '../core/db/runs';
import type { OpportunityDetail, OpportunityListItem } from '../core/db/schemas';
import type { ScanSummary, SourceOutcome } from '../core/runner';
import { settingKeySchema, type SettingKey, type Settings } from '../core/settings/schema';

export const IPC_CHANNELS = {
  settingsGetAll: 'settings:get-all',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appGetWindowInfo: 'app:get-window-info',
  appOpenExternal: 'app:open-external',
  appNavCounts: 'app:nav-counts',
  appCopyText: 'app:copy-text',
  appOpenMail: 'app:open-mail',
  outreachList: 'outreach:list',
  outreachSaveDraft: 'outreach:save-draft',
  outreachTemplates: 'outreach:templates',
  outreachSaveTemplate: 'outreach:save-template',
  outreachDeleteTemplate: 'outreach:delete-template',
  opportunitiesList: 'opportunities:list',
  opportunitiesGet: 'opportunities:get',
  opportunitiesSetStarred: 'opportunities:set-starred',
  opportunitiesDismiss: 'opportunities:dismiss',
  opportunitiesRestore: 'opportunities:restore',
  pipelineAdd: 'pipeline:add',
  pipelineRemove: 'pipeline:remove',
  pipelineList: 'pipeline:list',
  pipelineCreate: 'pipeline:create',
  pipelineUpdate: 'pipeline:update',
  pipelineImportCsv: 'pipeline:import-csv',
  deadlinesList: 'deadlines:list',
  deadlinesAdd: 'deadlines:add',
  deadlinesRemove: 'deadlines:remove',
  deadlinesSnooze: 'deadlines:snooze',
  deadlinesDone: 'deadlines:done',
  deadlinesUndoDone: 'deadlines:undo-done',
  deadlinesExportIcs: 'deadlines:export-ics',
  programsList: 'programs:list',
  programsCreate: 'programs:create',
  programsUpdate: 'programs:update',
  programsDelete: 'programs:delete',
  programsCheck: 'programs:check',
  programsMarkReviewed: 'programs:mark-reviewed',
  sourcesList: 'sources:list',
  sourcesSetPaused: 'sources:set-paused',
  sourcesAdd: 'sources:add',
  sourcesDelete: 'sources:delete',
  sourcesTest: 'sources:test',
  rulesGet: 'rules:get',
  rulesSave: 'rules:save',
  rulesReset: 'rules:reset',
  rulesRescore: 'rules:rescore',
  rulesPreview: 'rules:preview',
  devLoadSample: 'dev:load-sample',
  devClearSample: 'dev:clear-sample',
  scanRun: 'scan:run',
  scanStatus: 'scan:status',
} as const;

/** Events main sends to the renderer (no payload validation needed: main is trusted). */
export const IPC_EVENTS = {
  scanProgress: 'scan:progress',
  scanFinished: 'scan:finished',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const noPayload = z.undefined();
const idsSchema = z.array(z.int().positive()).min(1).max(10_000);

// Payload schemas, checked in main for every message received.
export const settingsGetAllPayloadSchema = noPayload;
export const settingsGetPayloadSchema = z.strictObject({ key: settingKeySchema });
// The value itself is validated per key by the settings store.
export const settingsSetPayloadSchema = z.strictObject({
  key: settingKeySchema,
  value: z.unknown(),
});
export const appGetWindowInfoPayloadSchema = noPayload;
/** Only web links leave the app; file:, javascript: and custom schemes are refused. */
function isWebUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}
export const appOpenExternalPayloadSchema = z.strictObject({
  url: z.string().refine(isWebUrl, 'only http(s) links can open'),
});
/** "New since" for the Opportunities count: the last visit (or 3 days ago on the first). */
export const appNavCountsPayloadSchema = z.strictObject({ newSince: z.iso.datetime() });
export const appCopyTextPayloadSchema = z.strictObject({ text: z.string().max(50_000) });
/** A draft for the default mail app (mailto:). Nothing is sent. */
export const appOpenMailPayloadSchema = z.strictObject({
  to: z.string().max(320),
  subject: z.string().max(1000),
  body: z.string().max(20_000),
});
export const outreachListPayloadSchema = noPayload;
export const outreachSaveDraftPayloadSchema = z.strictObject({
  pipelineId: z.int().positive(),
  draft: draftInputSchema,
});
export const outreachTemplatesPayloadSchema = noPayload;
export const outreachSaveTemplatePayloadSchema = z.strictObject({
  id: z.int().positive().nullable(),
  template: templateInputSchema,
});
export const outreachDeleteTemplatePayloadSchema = z.strictObject({ id: z.int().positive() });
export const opportunitiesListPayloadSchema = noPayload;
export const opportunitiesGetPayloadSchema = z.strictObject({ id: z.int().positive() });
export const opportunitiesSetStarredPayloadSchema = z.strictObject({
  ids: idsSchema,
  starred: z.boolean(),
});
export const opportunitiesIdsPayloadSchema = z.strictObject({ ids: idsSchema });
export const pipelineAddPayloadSchema = z.strictObject({ opportunityIds: idsSchema });
export const pipelineRemovePayloadSchema = z.strictObject({ ids: idsSchema });
export const pipelineListPayloadSchema = noPayload;
export const pipelineCreatePayloadSchema = z.strictObject({ row: pipelineNewSchema });
export const pipelineUpdatePayloadSchema = z.strictObject({
  id: z.int().positive(),
  patch: pipelinePatchSchema,
});
export const pipelineImportCsvPayloadSchema = noPayload;
export const deadlinesListPayloadSchema = noPayload;
export const deadlinesAddPayloadSchema = z.strictObject({ deadline: manualDeadlineInputSchema });
export const deadlinesRemovePayloadSchema = z.strictObject({ id: z.int().positive() });
/** A deadline item (all its reminders), or one follow-up reminder. */
export const reminderTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('target'), type: deadlineTargetSchema, id: z.int().positive() }),
  z.strictObject({ kind: z.literal('reminder'), id: z.int().positive() }),
]);
export type ReminderTarget = z.output<typeof reminderTargetSchema>;
export const deadlinesSnoozePayloadSchema = z.strictObject({
  target: reminderTargetSchema,
  until: z.iso.datetime(),
});
export const deadlinesDonePayloadSchema = z.strictObject({ target: reminderTargetSchema });
export const deadlinesUndoDonePayloadSchema = z.strictObject({ ids: idsSchema });
export const deadlinesExportIcsPayloadSchema = noPayload;
export const programsListPayloadSchema = noPayload;
export const programsCreatePayloadSchema = z.strictObject({ program: programNewSchema });
export const programsUpdatePayloadSchema = z.strictObject({
  id: z.int().positive(),
  patch: programPatchSchema,
});
export const programIdPayloadSchema = z.strictObject({ id: z.int().positive() });
export const programsMarkReviewedPayloadSchema = z.strictObject({ alertId: z.int().positive() });
export const sourcesListPayloadSchema = noPayload;
export const sourcesSetPausedPayloadSchema = z.strictObject({
  id: z.int().positive(),
  paused: z.boolean(),
});
export const sourcesAddPayloadSchema = z.strictObject({ source: newSourceSchema });
export const sourceIdPayloadSchema = z.strictObject({ id: z.int().positive() });
/** Test a stored source by id, or a new one before adding it. */
export const sourcesTestPayloadSchema = z.union([
  z.strictObject({ id: z.int().positive() }),
  z.strictObject({ source: newSourceSchema }),
]);
export const rulesGetPayloadSchema = noPayload;
/** Validated in main by the rules schema (a large, nested object). */
export const rulesSavePayloadSchema = z.strictObject({ rules: z.record(z.string(), z.unknown()) });
export const rulesNoPayloadSchema = noPayload;
export const devPayloadSchema = noPayload;
export const scanRunPayloadSchema = z
  .strictObject({ sources: z.array(z.string().trim().min(1)).min(1).max(100).optional() })
  .optional();
export const scanStatusPayloadSchema = noPayload;

export interface WindowInfo {
  platform: string;
  /** False when running from source (dev, shots); enables dev-only routes such as Components. */
  isPackaged: boolean;
  /** Native backdrop behind transparent areas of the page. 'none' means the page paints it. */
  material: 'mica' | 'vibrancy' | 'none';
}

/** Result of "Import CSV": null when the file dialog was cancelled. */
export type PipelineImport = (ImportResult & { file: string }) | null;

/** Result of "Export .ics": null when the save dialog was cancelled. */
export type IcsExport = { file: string; count: number } | null;

export interface RulesState {
  /** The rules in use. */
  rules: Rules;
  /** seeds/rules.json, for "Reset to defaults" and showing what changed. */
  defaults: Rules;
  /** True when the Rules page's version is in use. */
  custom: boolean;
  /** A stored version that no longer validates (the defaults are used meanwhile). */
  error: string | null;
}

export type {
  PreviewItem,
  RescoreResult,
  Rules,
  DraftInput,
  OutreachItem,
  TemplateInput,
  TemplateRow,
  NavCounts,
  NewSource,
  SourceHealth,
  SourceItem,
  TestResult,
  PageCheck,
  ProgramItem,
  ProgramNew,
  ProgramPatch,
  ProgramStatus,
  AddToPipelineResult,
  DeadlineEvent,
  DeadlinesView,
  DueFollowup,
  ManualDeadlineInput,
  ImportResult,
  PipelineItem,
  PipelineNew,
  PipelinePatch,
  PipelineStatus,
  OpportunityDetail,
  OpportunityListItem,
  ScanSummary,
  SourceOutcome,
};

export interface ScanStatus {
  running: boolean;
  /** Enabled sources that have an adapter. */
  sourceCount: number;
  lastRun: RunRow | null;
  /** Finish time of the latest run in which at least one source worked (heartbeat). */
  lastSuccessAt: string | null;
}

export interface ScanProgress {
  done: number;
  total: number;
  outcome: SourceOutcome;
}

/** The API exposed to the renderer as `window.radar`. */
export interface RadarApi {
  settings: {
    getAll(): Promise<Settings>;
    get<K extends SettingKey>(key: K): Promise<Settings[K]>;
    /** Setting `autostart` also updates the OS login item; `theme` updates the native chrome. */
    set<K extends SettingKey>(key: K, value: Settings[K]): Promise<Settings[K]>;
  };
  app: {
    getWindowInfo(): Promise<WindowInfo>;
    /** Opens an http(s) link in the default browser. */
    openExternal(url: string): Promise<void>;
    /** Sidebar counts (same rules as each page). */
    navCounts(newSince: string): Promise<NavCounts>;
    copyText(text: string): Promise<void>;
    /** Opens a draft in the default mail app (mailto:). Radar never sends email. */
    openMail(to: string, subject: string, body: string): Promise<void>;
  };
  opportunities: {
    /** Open opportunities (not dismissed, not closed), best score first. */
    list(): Promise<OpportunityListItem[]>;
    /** Full detail for the drawer; rejects if the id does not exist. */
    get(id: number): Promise<OpportunityDetail>;
    setStarred(ids: number[], starred: boolean): Promise<number>;
    dismiss(ids: number[]): Promise<number>;
    restore(ids: number[]): Promise<number>;
  };
  pipeline: {
    add(opportunityIds: number[]): Promise<AddToPipelineResult>;
    /** Removes pipeline rows by id (Undo of `add`, or delete). */
    remove(ids: number[]): Promise<number>;
    /** Every row, by planned send date. */
    list(): Promise<PipelineItem[]>;
    /** A row not linked to a scanned posting. */
    create(row: PipelineNew): Promise<PipelineItem>;
    /** Marking Sent sets the sent date to now when empty; follow-ups follow the sent date. */
    update(id: number, patch: PipelinePatch): Promise<PipelineItem>;
    /** Asks for a CSV file (native dialog) and imports it; null when cancelled. */
    importCsv(): Promise<PipelineImport>;
  };
  deadlines: {
    /** Every dated deadline and expected window, plus follow-ups that are due. */
    list(): Promise<DeadlinesView>;
    /** Adds a manual deadline (reminded like a starred one); returns its id. */
    add(deadline: ManualDeadlineInput): Promise<number>;
    remove(id: number): Promise<number>;
    /** Brings the item back later; it leaves "Due soon" until then. */
    snooze(target: ReminderTarget, until: string): Promise<void>;
    /** No more reminders for it; returns reminder ids for Undo. */
    done(target: ReminderTarget): Promise<number[]>;
    undoDone(ids: number[]): Promise<number>;
    /** Saves upcoming deadlines as an .ics file (native save dialog); null when cancelled. */
    exportIcs(): Promise<IcsExport>;
  };
  programs: {
    /** Watched programs, changed pages first. */
    list(): Promise<ProgramItem[]>;
    create(program: ProgramNew): Promise<ProgramItem>;
    /** Edits make the program yours: the seed file no longer overwrites it. */
    update(id: number, patch: ProgramPatch): Promise<ProgramItem>;
    /** Only programs you added; seeded ones are marked Not applicable instead. */
    remove(id: number): Promise<number>;
    /** Fetches the program page now (robots.txt and rate limits still apply). */
    check(id: number): Promise<PageCheck>;
    markReviewed(alertId: number): Promise<void>;
  };
  sources: {
    /** Every source with its health and how many open postings it lists. */
    list(): Promise<SourceItem[]>;
    /** Pausing survives app restarts; a paused source is skipped by scans and page checks. */
    setPaused(id: number, paused: boolean): Promise<void>;
    /** An Ashby job board or a web page to watch. */
    add(source: NewSource): Promise<SourceItem>;
    /** Only sources you added that never found anything. */
    remove(id: number): Promise<number>;
    /** Fetches like a scan would and stores nothing. */
    test(target: { id: number } | { source: NewSource }): Promise<TestResult>;
  };
  outreach: {
    /** Pipeline rows with their draft (template and typed fields) and the values Radar knows. */
    list(): Promise<OutreachItem[]>;
    saveDraft(pipelineId: number, draft: DraftInput): Promise<void>;
    templates(): Promise<TemplateRow[]>;
    /** Creates (id null) or updates a template. */
    saveTemplate(id: number | null, template: TemplateInput): Promise<TemplateRow>;
    deleteTemplate(id: number): Promise<number>;
  };
  rules: {
    get(): Promise<RulesState>;
    /** Saves your version (validated) and re-scores everything with it. */
    save(rules: Rules): Promise<RescoreResult | null>;
    /** Back to seeds/rules.json, and re-score. */
    reset(): Promise<RescoreResult | null>;
    rescore(): Promise<RescoreResult | null>;
    /** A few real postings for the live preview. */
    preview(): Promise<PreviewItem[]>;
  };
  scan: {
    /** Scans every enabled source (or the named ones). Rejects if a scan is already running. */
    run(sources?: string[]): Promise<ScanSummary>;
    status(): Promise<ScanStatus>;
    /** Subscribe to per-source progress; returns an unsubscribe function. */
    onProgress(listener: (p: ScanProgress) => void): () => void;
    /** Subscribe to finished scans (from any trigger); returns an unsubscribe function. */
    onFinished(listener: (s: ScanSummary) => void): () => void;
  };
  /** Development builds only; rejects in packaged builds. */
  dev: {
    loadSampleData(): Promise<number>;
    clearSampleData(): Promise<number>;
  };
}
