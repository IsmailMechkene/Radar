import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineItem, PipelineNew, PipelinePatch } from '../../../../shared/ipc';
import { useToast } from '../../../components/Toast';
import { STATUS_META } from '../../lib/pipeline';
import { cleanIpcError } from '../../lib/settings-helpers';

/** Loads the pipeline over IPC; every change is confirmed with a toast (Undo where possible). */
export function usePipeline() {
  const [items, setItems] = useState<PipelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const itemsRef = useRef<PipelineItem[]>([]);
  useEffect(() => {
    itemsRef.current = items ?? [];
  }, [items]);

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[pipeline] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      window.radar.pipeline.list().then(
        (list) => {
          setItems(list);
          setError(null);
        },
        (err: unknown) => {
          console.error('[pipeline] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const replace = (row: PipelineItem) =>
    setItems((list) => (list ?? []).map((i) => (i.id === row.id ? row : i)));

  /** Saves a patch. Returns the saved row, or null when it failed (already reported). */
  const update = useCallback(
    async (id: number, patch: PipelinePatch, message: string): Promise<PipelineItem | null> => {
      const before = itemsRef.current.find((i) => i.id === id);
      try {
        const row = await window.radar.pipeline.update(id, patch);
        replace(row);
        toast({
          message,
          action: before
            ? {
                label: 'Undo',
                onAction: () => {
                  const undo: PipelinePatch = {};
                  for (const key of Object.keys(patch) as (keyof PipelinePatch)[]) {
                    (undo as Record<string, unknown>)[key] = before[key];
                  }
                  // Undoing "Sent" also clears the sent date it filled in.
                  if (patch.status && before.sent_at !== row.sent_at) undo.sent_at = before.sent_at;
                  void window.radar.pipeline
                    .update(id, undo)
                    .then(replace, (err: unknown) => fail('Undo', err));
                },
              }
            : undefined,
        });
        return row;
      } catch (err) {
        fail('Save', err);
        return null;
      }
    },
    [toast, fail],
  );

  const setStatus = useCallback(
    (item: PipelineItem, status: PipelineItem['status']) =>
      update(item.id, { status }, `${item.org} moved to ${STATUS_META[status].label}`),
    [update],
  );

  const create = useCallback(
    async (row: PipelineNew): Promise<PipelineItem | null> => {
      try {
        const created = await window.radar.pipeline.create(row);
        setItems((list) => [...(list ?? []), created]);
        await reload(); // keeps the planned-date order
        toast({
          message: `Added ${created.org}`,
          action: {
            label: 'Undo',
            onAction: () =>
              void window.radar.pipeline
                .remove([created.id])
                .then(reload, (err: unknown) => fail('Undo', err)),
          },
        });
        return created;
      } catch (err) {
        fail('Add entry', err);
        return null;
      }
    },
    [toast, fail, reload],
  );

  const remove = useCallback(
    async (item: PipelineItem): Promise<boolean> => {
      try {
        await window.radar.pipeline.remove([item.id]);
        setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
        toast({ message: `Deleted ${item.org}` });
        return true;
      } catch (err) {
        fail('Delete', err);
        return false;
      }
    },
    [toast, fail],
  );

  return { items, error, reload, update, setStatus, create, remove };
}

export type PipelineApi = ReturnType<typeof usePipeline>;
