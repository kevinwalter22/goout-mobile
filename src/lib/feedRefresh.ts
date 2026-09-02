// One-shot cross-screen signal: a mutation (e.g. creating an event) marks the
// explore feed stale; the explore screen consumes it on its next focus and refetches
// ONCE. This makes a newly-created event appear on return without a manual reload —
// while avoiding a full feed refetch on every ordinary tab switch.
let dirty = false;

export function markFeedDirty(): void {
  dirty = true;
}

/** Returns true (and clears) if the feed was marked stale since the last consume. */
export function consumeFeedDirty(): boolean {
  const wasDirty = dirty;
  dirty = false;
  return wasDirty;
}
