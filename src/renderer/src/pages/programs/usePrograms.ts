import { useCallback, useEffect, useState } from 'react';
import { notifyDataChanged } from '../../lib/data-events';
import type { ProgramItem, ProgramNew, ProgramPatch } from '../../../../shared/ipc';
import { useToast } from '../../../components/Toast';
import { cleanIpcError } from '../../lib/settings-helpers';

/** Loads programs over IPC; every action is confirmed with a toast. */
export function usePrograms() {
  const [items, setItems] = useState<ProgramItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<ReadonlySet<number>>(new Set());
  const toast = useToast();

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[programs] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      window.radar.programs.list().then(
        (list) => {
          setItems(list);
          notifyDataChanged();
          setError(null);
        },
        (err: unknown) => {
          console.error('[programs] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (id: number, patch: ProgramPatch, name: string): Promise<boolean> => {
      try {
        await window.radar.programs.update(id, patch);
        await reload();
        toast({ message: `Saved ${name}` });
        return true;
      } catch (err) {
        fail('Save', err);
        return false;
      }
    },
    [reload, toast, fail],
  );

  const create = useCallback(
    async (program: ProgramNew): Promise<boolean> => {
      try {
        const created = await window.radar.programs.create(program);
        await reload();
        toast({ message: `Watching ${created.name}` });
        return true;
      } catch (err) {
        fail('Watch a program', err);
        return false;
      }
    },
    [reload, toast, fail],
  );

  const remove = useCallback(
    async (p: ProgramItem): Promise<boolean> => {
      try {
        await window.radar.programs.remove(p.id);
        await reload();
        toast({ message: `Deleted ${p.name}` });
        return true;
      } catch (err) {
        fail('Delete', err);
        return false;
      }
    },
    [reload, toast, fail],
  );

  const check = useCallback(
    async (p: ProgramItem) => {
      setChecking((s) => new Set(s).add(p.id));
      try {
        const r = await window.radar.programs.check(p.id);
        await reload();
        const message =
          r.outcome === 'changed'
            ? `${p.name}: page changed, review`
            : r.outcome === 'baseline'
              ? `${p.name}: page saved; changes are flagged from now on`
              : r.outcome === 'unchanged'
                ? `${p.name}: no change`
                : r.outcome === 'failed'
                  ? `${p.name}: check failed: ${r.error}`
                  : `${p.name}: checked recently`;
        toast({ message, tone: r.outcome === 'failed' ? 'error' : 'success' });
      } catch (err) {
        fail('Check', err);
      } finally {
        setChecking((s) => {
          const next = new Set(s);
          next.delete(p.id);
          return next;
        });
      }
    },
    [reload, toast, fail],
  );

  const markReviewed = useCallback(
    async (p: ProgramItem) => {
      if (p.alert_id === null) return;
      try {
        await window.radar.programs.markReviewed(p.alert_id);
        await reload();
        toast({ message: `Marked reviewed · ${p.name}` });
      } catch (err) {
        fail('Mark reviewed', err);
      }
    },
    [reload, toast, fail],
  );

  return { items, error, checking, reload, save, create, remove, check, markReviewed };
}
