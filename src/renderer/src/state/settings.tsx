import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { SettingKey, Settings } from '../../../core/settings/schema';
import { useToast } from '../../components/Toast';
import { cleanIpcError } from '../lib/settings-helpers';

interface UpdateOptions {
  /** Toast text on success; false for no toast. Default "Saved" with Undo. */
  toast?: string | false;
}

type UpdateFn = <K extends SettingKey>(
  key: K,
  value: Settings[K],
  opts?: UpdateOptions,
) => Promise<boolean>;

interface SettingsContextValue {
  settings: Settings | null;
  loadError: string | null;
  update: UpdateFn;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}

/** Loads settings over IPC and saves each change immediately (optimistic, reverted on error). */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toast = useToast();
  const current = useRef<Settings | null>(null);
  const updateRef = useRef<UpdateFn | null>(null);

  useEffect(() => {
    current.current = settings;
  }, [settings]);

  useEffect(() => {
    window.radar.settings.getAll().then(setSettings, (err: unknown) => {
      console.error('[settings] load failed', err);
      setLoadError(cleanIpcError(err));
    });
  }, []);

  const update = useCallback<UpdateFn>(
    async (key, value, opts = {}) => {
      const before = current.current;
      if (!before) return false;
      const previous = before[key];
      const patch = (v: typeof value) => setSettings((s) => (s ? { ...s, [key]: v } : s));
      patch(value);
      try {
        const stored = await window.radar.settings.set(key, value);
        patch(stored);
        if (opts.toast !== false) {
          toast({
            message: opts.toast ?? 'Saved',
            action: {
              label: 'Undo',
              onAction: () => void updateRef.current?.(key, previous, { toast: 'Change undone' }),
            },
          });
        }
        return true;
      } catch (err) {
        console.error(`[settings] saving ${key} failed`, err);
        patch(previous);
        toast({ tone: 'error', message: `Not saved: ${cleanIpcError(err)}` });
        return false;
      }
    },
    [toast],
  );

  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  const value = useMemo(() => ({ settings, loadError, update }), [settings, loadError, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
