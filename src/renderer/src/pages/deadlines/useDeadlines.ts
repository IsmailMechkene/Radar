import { useCallback, useEffect, useState } from 'react';
import { notifyDataChanged } from '../../lib/data-events';
import type { DeadlinesView, ManualDeadlineInput, ReminderTarget } from '../../../../shared/ipc';
import { useToast } from '../../../components/Toast';
import type { DueItem } from '../../lib/deadlines';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useScan } from '../../state/scan';

const targetOf = (item: DueItem): ReminderTarget =>
  item.kind === 'followup'
    ? { kind: 'reminder', id: item.followup.reminder_id }
    : { kind: 'target', type: item.event.target_type, id: item.event.target_id };

const nameOf = (item: DueItem) =>
  item.kind === 'followup' ? `follow-up with ${item.followup.org}` : item.event.title;

/** Loads deadlines over IPC; every action is confirmed with a toast (Undo where possible). */
export function useDeadlines() {
  const [view, setView] = useState<DeadlinesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const scan = useScan();

  const fail = useCallback(
    (what: string, err: unknown) => {
      console.error(`[deadlines] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    },
    [toast],
  );

  const reload = useCallback(
    () =>
      window.radar.deadlines.list().then(
        (v) => {
          setView(v);
          notifyDataChanged();
          setError(null);
        },
        (err: unknown) => {
          console.error('[deadlines] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  // First load, and again after every scan (new postings may bring deadlines).
  useEffect(() => {
    void reload();
  }, [reload, scan.version]);

  const snooze = useCallback(
    async (item: DueItem) => {
      const until = new Date(Date.now() + 86_400_000).toISOString();
      try {
        await window.radar.deadlines.snooze(targetOf(item), until);
        await reload();
        toast({ message: `Snoozed 1 day · ${nameOf(item)}` });
      } catch (err) {
        fail('Snooze', err);
      }
    },
    [reload, toast, fail],
  );

  const done = useCallback(
    async (item: DueItem) => {
      try {
        const ids = await window.radar.deadlines.done(targetOf(item));
        await reload();
        toast({
          message: `Marked done · ${nameOf(item)}`,
          action: {
            label: 'Undo',
            onAction: () =>
              void window.radar.deadlines
                .undoDone(ids)
                .then(reload, (err: unknown) => fail('Undo', err)),
          },
        });
      } catch (err) {
        fail('Done', err);
      }
    },
    [reload, toast, fail],
  );

  const add = useCallback(
    async (input: ManualDeadlineInput): Promise<boolean> => {
      try {
        const id = await window.radar.deadlines.add(input);
        await reload();
        toast({
          message: `Added deadline · ${input.title.trim()}`,
          action: {
            label: 'Undo',
            onAction: () =>
              void window.radar.deadlines
                .remove(id)
                .then(reload, (err: unknown) => fail('Undo', err)),
          },
        });
        return true;
      } catch (err) {
        fail('Add deadline', err);
        return false;
      }
    },
    [reload, toast, fail],
  );

  const remove = useCallback(
    async (id: number, title: string) => {
      try {
        await window.radar.deadlines.remove(id);
        await reload();
        toast({ message: `Deleted deadline · ${title}` });
      } catch (err) {
        fail('Delete', err);
      }
    },
    [reload, toast, fail],
  );

  return { view, error, reload, snooze, done, add, remove };
}
