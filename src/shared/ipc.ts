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

export type {
  AddToPipelineResult,
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
