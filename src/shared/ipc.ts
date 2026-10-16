// Single source of truth for IPC between main, preload and renderer. No Electron imports here.
import { z } from 'zod';
import { settingKeySchema, type SettingKey, type Settings } from '../core/settings/schema';

export const IPC_CHANNELS = {
  settingsGetAll: 'settings:get-all',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// Payload schemas, checked in main for every message received.
export const settingsGetAllPayloadSchema = z.undefined();
export const settingsGetPayloadSchema = z.strictObject({ key: settingKeySchema });
// The value itself is validated per key by the settings store.
export const settingsSetPayloadSchema = z.strictObject({
  key: settingKeySchema,
  value: z.unknown(),
});

/** The API exposed to the renderer as `window.radar`. */
export interface RadarApi {
  settings: {
    getAll(): Promise<Settings>;
    get<K extends SettingKey>(key: K): Promise<Settings[K]>;
    /** Setting `autostart` also updates the OS login item. */
    set<K extends SettingKey>(key: K, value: Settings[K]): Promise<Settings[K]>;
  };
}
