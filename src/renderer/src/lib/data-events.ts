// A page changed data that the sidebar counts depend on (pipeline, deadlines, programs,
// opportunities): tell the counts to refresh now instead of at the next minute.
export const DATA_CHANGED = 'radar:data-changed';

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED));
}
