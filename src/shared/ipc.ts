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
import type { CopilotItem, Dimension, Grade, Review, StoredReview } from '../core/copilot/reviews';
import type { NavCounts } from '../core/nav';
import type { RescoreResult } from '../core/rules/rescore';
import type { ResolvedTheme, WindowAction, WindowState } from './theme';
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

/**
 * Always answered, locked or not: window chrome and the lock itself. Nothing here reads the
 * database.
 */
export const SHELL_CHANNELS = {
  appGetWindowInfo: 'app:get-window-info',
  appChromeTheme: 'app:chrome-theme',
  windowControl: 'window:control',
  windowState: 'window:state',
  authStatus: 'auth:status',
  authSetup: 'auth:setup',
  authUnlock: 'auth:unlock',
  authRecover: 'auth:recover',
  authConfirmRecovery: 'auth:confirm-recovery',
  authLock: 'auth:lock',
  authCreateAccount: 'auth:create-account',
  authSignIn: 'auth:sign-in',
  authGoogle: 'auth:google',
  authCancel: 'auth:cancel',
  authEmailConfirmed: 'auth:email-confirmed',
  authConfirmCode: 'auth:confirm-code',
  authResendEmail: 'auth:resend-email',
  authRequestReset: 'auth:request-reset',
  authSetNewPassword: 'auth:set-new-password',
  authChoosePassword: 'auth:choose-password',
  authFinishPasswordChange: 'auth:finish-password-change',
  authSignOut: 'auth:sign-out',
  authJoin: 'auth:join',
  authSkipJoin: 'auth:skip-join',
} as const;

/** Data channels: registered on unlock, removed on lock. */
export const IPC_CHANNELS = {
  settingsGetAll: 'settings:get-all',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appOpenExternal: 'app:open-external',
  appNavCounts: 'app:nav-counts',
  dataBackupInfo: 'data:backup-info',
  dataBackupNow: 'data:backup-now',
  dataChooseBackupFolder: 'data:choose-backup-folder',
  dataOpenBackupFolder: 'data:open-backup-folder',
  dataExportJson: 'data:export-json',
  dataExportCsv: 'data:export-csv',
  appCopyText: 'app:copy-text',
  appOpenMail: 'app:open-mail',
  outreachList: 'outreach:list',
  outreachSaveDraft: 'outreach:save-draft',
  outreachTemplates: 'outreach:templates',
  outreachSaveTemplate: 'outreach:save-template',
  outreachDeleteTemplate: 'outreach:delete-template',
  opportunitiesList: 'opportunities:list',
  opportunitiesGet: 'opportunities:get',
  opportunitiesSearch: 'opportunities:search',
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
  syncStatus: 'sync:status',
  syncNow: 'sync:now',
  syncUseRecoveryKey: 'sync:use-recovery-key',
  copilotCheck: 'copilot:check',
  copilotList: 'copilot:list',
  copilotStatus: 'copilot:status',
  copilotReview: 'copilot:review',
  copilotReviewWaiting: 'copilot:review-waiting',
  copilotStop: 'copilot:stop',
} as const;

/** Events main sends to the renderer (no payload validation needed: main is trusted). */
export const IPC_EVENTS = {
  scanProgress: 'scan:progress',
  scanFinished: 'scan:finished',
  matchAlert: 'app:match-alert',
  authChanged: 'auth:changed',
  windowState: 'window:state-changed',
  syncChanged: 'sync:changed',
  /** Rows from another device were written here: pages reload their data. */
  syncApplied: 'sync:applied',
  copilotChanged: 'copilot:changed',
} as const;

/** Where the lock stands (main -> page). */
/** The account this computer's data belongs to (no tokens: those stay in main). */
export interface AccountInfo {
  email: string;
  /** Email users unlock with their account password; Google users with a Radar password. */
  provider: 'email' | 'google';
}

/** The account session while unlocked: renewed, waiting for the network, or ended. */
export type SessionState = 'online' | 'offline' | 'expired';

export type AuthStatus =
  /** Accounts off (screenshots, or no .env): first run with a local password only. */
  | { state: 'setup'; hasPlainData: boolean }
  /**
   * Sign in or create an account. `new`: first run. `connect`: data set up before accounts,
   * unlocked, to be linked. `again`: data linked to `account`, no session (signed out or ended).
   * `problem`: why the last attempt (or a browser sign-in) failed.
   */
  | {
      state: 'signin';
      purpose: 'new' | 'connect' | 'again';
      account: AccountInfo | null;
      hasPlainData: boolean;
      problem: string | null;
    }
  /** A link was emailed (confirm the address, or reset the password); waiting for it. */
  | { state: 'check-email'; email: string; purpose: 'signup' | 'reset'; problem: string | null }
  /** Google sign-in is open in the browser. */
  | { state: 'browser' }
  /** First Google sign-in on this computer: choose the password that encrypts the data here. */
  | { state: 'choose-password'; account: AccountInfo; hasPlainData: boolean }
  /** Opened from a reset link: a new password, and the recovery key when data exists here. */
  | { state: 'new-password'; account: AccountInfo; hasData: boolean }
  /** The account password changed (elsewhere): the recovery key re-encrypts the data here. */
  | { state: 'password-changed'; account: AccountInfo }
  /** First sign-in on another computer of an account with synced data: its recovery key. */
  | { state: 'join'; account: AccountInfo; problem: string | null }
  /** Unlock with a password. `account` null: data from before accounts (linked after unlock). */
  | { state: 'locked'; account: AccountInfo | null }
  /** `recoveryKey` is set until the user confirms they saved it (shown once). */
  | {
      state: 'unlocked';
      recoveryKey: string | null;
      account: AccountInfo | null;
      session: SessionState | null;
    }
  /** The data cannot be opened (damaged or missing keys.json, accounts not configured). */
  | { state: 'error'; message: string };

/**
 * End-to-end encrypted sync of the user's own rows (main -> page). `needs-recovery-key`: this
 * computer's data was encrypted before it joined the account; the account's recovery key links it.
 */
export interface SyncStatus {
  state: 'off' | 'syncing' | 'synced' | 'offline' | 'signed-out' | 'needs-recovery-key' | 'error';
  lastSyncedAt: string | null;
  /** Local changes not uploaded yet. */
  pending: number;
  /** Why it is not syncing, or what could not be applied. */
  message: string | null;
}

/** New strong matches found by a scan (main -> page). */
export interface MatchAlertEvent {
  ids: number[];
  title: string;
  body: string;
  /** The notification was clicked: open the matches. Otherwise the window had focus: show a toast. */
  open: boolean;
}

export type IpcChannel =
  | (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
  | (typeof SHELL_CHANNELS)[keyof typeof SHELL_CHANNELS];

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
// Strength is checked by the vault; these bounds only keep payloads sane.
const secret = z.string().min(1).max(512);
export const authNoPayloadSchema = noPayload;
export const authPasswordPayloadSchema = z.strictObject({ password: secret });
export const authRecoverPayloadSchema = z.strictObject({
  recoveryKey: secret,
  newPassword: secret,
});
const email = z.email().max(320);
export const authCredentialsPayloadSchema = z.strictObject({ email, password: secret });
export const authEmailPayloadSchema = z.strictObject({ email });
/** The code from a confirmation email (Supabase sends 6 to 10 digits). */
export const authCodePayloadSchema = z.strictObject({ code: z.string().regex(/^\d{6,10}$/) });
export const authNewPasswordPayloadSchema = z.strictObject({
  password: secret,
  recoveryKey: z.string().max(512),
});
export const authRecoveryKeyPayloadSchema = z.strictObject({ recoveryKey: secret });
export const syncNoPayloadSchema = noPayload;
export const syncRecoveryKeyPayloadSchema = authRecoveryKeyPayloadSchema;
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
/** The theme the page has just painted; the native window controls follow it. */
export const windowControlPayloadSchema = z.strictObject({
  action: z.enum(['minimize', 'toggle-maximize', 'close']),
});
export const windowStatePayloadSchema = noPayload;
export const appChromeThemePayloadSchema = z.strictObject({
  theme: z.enum(['light', 'dark']),
});
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
export const dataNoPayloadSchema = noPayload;
export const opportunitiesListPayloadSchema = noPayload;
export const opportunitiesGetPayloadSchema = z.strictObject({ id: z.int().positive() });
export const opportunitiesSearchPayloadSchema = z.strictObject({ query: z.string().max(200) });
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
export const copilotNoPayloadSchema = noPayload;
export const copilotReviewPayloadSchema = z.strictObject({ ids: idsSchema });

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

export interface BackupInfo {
  folder: string;
  /** False while the default folder (inside Radar's data folder) is used. */
  chosen: boolean;
  count: number;
  last: { file: string; date: string; size: number; modifiedAt: string } | null;
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

/** Settings > Radar Copilot > Check: Claude Code found and answering, or why not. */
export type CopilotCheck =
  | { ok: true; path: string; version: string; durationMs: number | null }
  | {
      ok: false;
      code: 'not-found' | 'not-signed-in' | 'timeout' | 'failed' | 'invalid-output' | 'stopped';
      problem: string;
    };

/** Radar Copilot's review queue (main -> page). */
export interface CopilotStatus {
  running: boolean;
  /** The posting being reviewed now. */
  current: { id: number; title: string; org: string } | null;
  /** Postings still queued in this run, in order. */
  queued: number[];
  /** Reviews finished in this run. */
  done: number;
  /** Postings whose last review failed, newest first. */
  failures: { id: number; problem: string }[];
  /** Why the last review failed or a run did not start; null after a clean run. */
  lastError: string | null;
}

export type { CopilotItem, Dimension, Grade, Review, StoredReview };

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
  /** Works while locked. Every other group needs Radar unlocked. */
  auth: {
    status(): Promise<AuthStatus>;
    /** First run: sets the password, encrypts existing data; the result carries the recovery key. */
    setup(password: string): Promise<AuthStatus>;
    unlock(password: string): Promise<AuthStatus>;
    /** Forgot password: opens with the recovery key and sets a new password. */
    recover(recoveryKey: string, newPassword: string): Promise<AuthStatus>;
    /** The user saved the recovery key; it is not shown again. */
    confirmRecoveryKey(): Promise<AuthStatus>;
    /** Stops background work, closes the database and shows the lock screen. */
    lock(): Promise<AuthStatus>;
    /** Lock state changes (also from the tray); returns the unsubscribe function. */
    onChanged(listener: (s: AuthStatus) => void): () => void;
    /** New account; usually continues with "check your email". */
    createAccount(email: string, password: string): Promise<AuthStatus>;
    signIn(email: string, password: string): Promise<AuthStatus>;
    /** Opens Google sign-in in the browser; the result arrives as a status change. */
    google(): Promise<AuthStatus>;
    /** Leaves "check your email" or the browser wait. */
    cancel(): Promise<AuthStatus>;
    /** "I've confirmed my email": signs in with the password from the sign-up. */
    emailConfirmed(): Promise<AuthStatus>;
    /** The code from the confirmation email, instead of opening its link. */
    confirmCode(code: string): Promise<AuthStatus>;
    resendEmail(): Promise<AuthStatus>;
    /** Emails a reset link. */
    requestReset(email: string): Promise<AuthStatus>;
    /** After the reset link: new password, plus the recovery key for data kept here. */
    setNewPassword(password: string, recoveryKey: string): Promise<AuthStatus>;
    /** First Google sign-in here: the password that encrypts this computer's data. */
    choosePassword(password: string): Promise<AuthStatus>;
    /** The account password changed elsewhere: the recovery key re-encrypts the data. */
    finishPasswordChange(recoveryKey: string): Promise<AuthStatus>;
    /** Forgets the session on this computer and locks. */
    signOut(): Promise<AuthStatus>;
    /** Another computer of a synced account: the account's recovery key opens its data here. */
    join(recoveryKey: string): Promise<AuthStatus>;
    /** No recovery key at hand: start with empty data here (sync waits for the key). */
    skipJoin(): Promise<AuthStatus>;
  };
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
    /** New-match alerts from scans; returns the unsubscribe function. */
    onMatchAlert(listener: (e: MatchAlertEvent) => void): () => void;
    /** Recolors the native window controls once the page shows `theme` (so they never lead). */
    setChromeTheme(theme: ResolvedTheme): Promise<void>;
    /** The window buttons drawn by the page (not on macOS). */
    windowControl(action: WindowAction): Promise<void>;
    windowState(): Promise<WindowState>;
    /** Maximized or restored, focused or not; returns the unsubscribe function. */
    onWindowState(listener: (s: WindowState) => void): () => void;
    copyText(text: string): Promise<void>;
    /** Opens a draft in the default mail app (mailto:). Radar never sends email. */
    openMail(to: string, subject: string, body: string): Promise<void>;
  };
  opportunities: {
    /** Open opportunities (not dismissed, not closed), best score first. */
    list(): Promise<OpportunityListItem[]>;
    /** Ids matching every word in title, org, location, source or description. */
    search(query: string): Promise<number[]>;
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
    /** An Ashby, Greenhouse, Lever or Recruitee job board, or a web page to watch. */
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
  data: {
    backupInfo(): Promise<BackupInfo>;
    /** Today's backup now (replaces an earlier one from today); keeps the last 14. */
    backupNow(): Promise<BackupInfo & { pruned: number }>;
    /** Folder picker; null when cancelled. */
    chooseBackupFolder(): Promise<BackupInfo | null>;
    openBackupFolder(): Promise<void>;
    /** Everything as one JSON file (save dialog); null when cancelled. */
    exportJson(): Promise<{ path: string } | null>;
    /** One CSV per table in a new folder (folder picker); null when cancelled. */
    exportCsv(): Promise<{ path: string; files: number } | null>;
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
  sync: {
    status(): Promise<SyncStatus>;
    /** Syncs right away. */
    now(): Promise<SyncStatus>;
    /** Links data encrypted before joining to the account (see SyncStatus). */
    useRecoveryKey(recoveryKey: string): Promise<SyncStatus>;
    onChanged(listener: (s: SyncStatus) => void): () => void;
    /** Rows from another device arrived; returns the unsubscribe function. */
    onApplied(listener: () => void): () => void;
  };
  copilot: {
    /** Finds Claude Code and makes one tiny request with the saved settings (a few seconds). */
    check(): Promise<CopilotCheck>;
    /** Open postings the rules passed, and every open posting with a review. */
    list(): Promise<CopilotItem[]>;
    status(): Promise<CopilotStatus>;
    /** Reviews these postings (again). Rejects when Copilot is off or has no master CV. */
    review(ids: number[]): Promise<CopilotStatus>;
    /** Reviews every posting still waiting. */
    reviewWaiting(): Promise<CopilotStatus>;
    /** Empties the queue and stops the review that is running. */
    stop(): Promise<CopilotStatus>;
    /** Queue progress; returns the unsubscribe function. */
    onChanged(listener: (s: CopilotStatus) => void): () => void;
  };
  /** Development builds only; rejects in packaged builds. */
  dev: {
    loadSampleData(): Promise<number>;
    clearSampleData(): Promise<number>;
  };
}
