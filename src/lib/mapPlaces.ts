// Location-aggregated map model. A local-discovery map is about PLACES and what's
// happening at them — not one pin per event. In the catalog many events stack on
// a single venue coordinate (e.g. a theatre with 31 shows on one point), which no
// map engine can render as 31 distinct pins. So we collapse all mappable items to
// one feature per place, dedup recurring occurrences by series, and carry the
// event count + the item ids for the "what's happening here" tap sheet.
//
// This is the data model under the Mapbox symbol layer (see
// docs/design/map_engine_redesign.md), and is deliberately pure/testable.

import { emojiForItem } from "../utils/mapEmoji";
import type { ExploreItem } from "../types/database";

// ~11 m grid: items within this collapse to the same place. Enough to merge the
// many events sharing a venue coordinate without merging distinct neighbours.
const COORD_PRECISION = 4;

export type PlaceFeature = {
  id: string; // stable place id (rounded "lat,lng") — used for keys + feature-state
  lat: number;
  lng: number;
  emoji: string; // representative icon (the venue's, else the top event's)
  title: string; // venue name, else the most-notable event's title
  eventCount: number; // # of distinct upcoming events here (series-deduped)
  hasEvents: boolean;
  hasActivity: boolean; // is this also a browsable venue
  notability: number; // max notability at the place (venue LOD)
  itemIds: string[]; // every item at this place (for the tap sheet)
};

const nota = (it: ExploreItem): number => (it as any).notability_score ?? 0;
const seriesKey = (it: ExploreItem): string => (it as any).series_id ?? it.id;

/** Collapse mappable items into one feature per place (venue/coordinate). */
export function aggregateToPlaces(items: ExploreItem[]): PlaceFeature[] {
  const groups = new Map<string, ExploreItem[]>();
  for (const it of items) {
    if (it.lat == null || it.lng == null) continue;
    const key = `${it.lat.toFixed(COORD_PRECISION)},${it.lng.toFixed(COORD_PRECISION)}`;
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  const out: PlaceFeature[] = [];
  for (const [key, group] of groups) {
    const events = group.filter((i) => i.kind === "event");
    const activities = group.filter((i) => i.kind === "activity");

    // Distinct upcoming events, deduped by series (a weekly show counts once).
    const seriesSet = new Set(events.map(seriesKey));
    const eventCount = seriesSet.size;

    // Representative item: the venue defines the place when present; otherwise the
    // most-notable event. Drives the icon + title.
    const byNotaDesc = (a: ExploreItem, b: ExploreItem) => nota(b) - nota(a);
    const rep =
      [...activities].sort(byNotaDesc)[0] ?? [...events].sort(byNotaDesc)[0];
    if (!rep) continue;

    // User-created items fall back to a clean location pin — NOT the Twemoji calendar
    // 📅, which always renders "JUL 17". (Cover-photo pins need Option B; see PR notes.)
    const repIsUserMade = !!(rep as any).created_by_user_id;
    let emoji = emojiForItem(rep);
    if (repIsUserMade && emoji === "📅") emoji = "📍";

    out.push({
      id: key,
      lat: rep.lat as number,
      lng: rep.lng as number,
      emoji,
      title: rep.title,
      eventCount,
      hasEvents: eventCount > 0,
      hasActivity: activities.length > 0,
      notability: group.reduce((m, i) => Math.max(m, nota(i)), 0),
      itemIds: group.map((i) => i.id),
    });
  }
  return out;
}

/**
 * Render priority for a place (higher = drawn first, wins collision, survives
 * cap). Places with events rank above venues; within each, by notability. Used
 * both by the current selection logic and as the Mapbox `symbol-sort-key`
 * (negated there, since Mapbox draws lowest sort-key first).
 */
export function placePriority(p: PlaceFeature): number {
  return (p.hasEvents ? 1000 : 0) + p.notability;
}
