import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpportunityListItem } from '../../../../shared/ipc';
import { useToast } from '../../../components/Toast';
import { cleanIpcError } from '../../lib/settings-helpers';

type Item = OpportunityListItem;

const name = (items: readonly Item[], ids: readonly number[]) =>
  ids.length === 1 ? (items.find((i) => i.id === ids[0])?.org ?? '1 opportunity') : null;

/** Loads the list over IPC and performs every mutation with a toast (Undo where reversible). */
export function useOpportunities() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items ?? [];
  }, [items]);

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[opportunities] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      window.radar.opportunities.list().then(
        (list) => {
          setItems(list);
          setError(null);
        },
        (err: unknown) => {
          console.error('[opportunities] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const setStarred = useCallback(
    async (ids: number[], starred: boolean) => {
      const before = itemsRef.current;
      setItems(before.map((i) => (ids.includes(i.id) ? { ...i, starred } : i)));
      try {
        await window.radar.opportunities.setStarred(ids, starred);
        const who = name(before, ids);
        toast({
          message: `${starred ? 'Starred' : 'Unstarred'}${who ? ` · ${who}` : ` ${ids.length} opportunities`}`,
        });
      } catch (err) {
        setItems(before);
        fail(starred ? 'Star' : 'Unstar', err);
      }
    },
    [toast, fail],
  );

  const dismiss = useCallback(
    async (ids: number[]) => {
      const before = itemsRef.current;
      try {
        await window.radar.opportunities.dismiss(ids);
        setItems(before.filter((i) => !ids.includes(i.id)));
        const who = name(before, ids);
        toast({
          message: who ? `Dismissed · ${who}` : `Dismissed ${ids.length} opportunities`,
          action: {
            label: 'Undo',
            onAction: () => {
              window.radar.opportunities
                .restore(ids)
                .then(reload, (err: unknown) => fail('Restore', err));
            },
          },
        });
      } catch (err) {
        fail('Dismiss', err);
      }
    },
    [toast, fail, reload],
  );

  const addToPipeline = useCallback(
    async (ids: number[]) => {
      try {
        const { added, skipped } = await window.radar.pipeline.add(ids);
        if (added.length === 0) {
          toast({ message: ids.length === 1 ? 'Already in Pipeline' : 'All already in Pipeline' });
          return;
        }
        const who = name(itemsRef.current, ids);
        const extra = skipped ? ` (${skipped} already there)` : '';
        toast({
          message: who ? `Added to Pipeline · ${who}` : `Added ${added.length} to Pipeline${extra}`,
          action: {
            label: 'Undo',
            onAction: () => {
              window.radar.pipeline.remove(added).catch((err: unknown) => fail('Undo', err));
            },
          },
        });
      } catch (err) {
        fail('Add to Pipeline', err);
      }
    },
    [toast, fail],
  );

  const openExternal = useCallback(
    (url: string) => {
      window.radar.app.openExternal(url).catch((err: unknown) => fail('Opening the link', err));
    },
    [fail],
  );

  const copy = useCallback(
    async (text: string, message: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast({ message });
      } catch (err) {
        fail('Copy', err);
      }
    },
    [toast, fail],
  );

  const loadSample = useCallback(async () => {
    try {
      const n = await window.radar.dev.loadSampleData();
      await reload();
      toast({ message: `Loaded ${n} sample opportunities` });
    } catch (err) {
      fail('Loading sample data', err);
    }
  }, [reload, toast, fail]);

  const clearSample = useCallback(async () => {
    try {
      const n = await window.radar.dev.clearSampleData();
      await reload();
      toast({ message: `Removed ${n} sample opportunities` });
    } catch (err) {
      fail('Removing sample data', err);
    }
  }, [reload, toast, fail]);

  return {
    items,
    error,
    reload,
    setStarred,
    dismiss,
    addToPipeline,
    openExternal,
    copy,
    loadSample,
    clearSample,
  };
}

export type OpportunitiesApi = ReturnType<typeof useOpportunities>;
