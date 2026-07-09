// Pure helpers for the map's Supercluster-based rendering. Kept separate from
// the React component so the zoom/bbox/LOD math is unit-testable.
//
// The map fetches a whole region once, indexes the points with Supercluster, and
// re-derives what's visible from (bbox, zoom) on every pan/zoom — WITHOUT
// refetching. That's what makes panning stable (items already in view persist;
// new ones enter at the edges) and makes zoom the level-of-detail control.

import type { MapRegion } from "../utils/mapViewport";

// Safety ceiling on how many native marker views we ever render at once.
// Emoji/teardrop markers are text (cheap) — far lighter than the old photo
// markers — but we still bound the count so a pathological view can't OOM.
export const MAX_RENDERED_MARKERS = 160;

/** react-native-maps longitudeDelta → integer slippy-map zoom (0–20). */
export function regionToZoom(region: MapRegion): number {
  const lngDelta = Math.max(region.longitudeDelta, 1e-6);
  const z = Math.log2(360 / lngDelta);
  return Math.max(0, Math.min(20, Math.round(z)));
}

/**
 * [west, south, east, north] padded around the region so pins just off-screen
 * are already mounted and slide in smoothly instead of popping. pad=0.3 → 30%
 * larger than the visible viewport.
 */
export function regionToPaddedBbox(
  region: MapRegion,
  pad = 0.3
): [number, number, number, number] {
  const halfLat = (region.latitudeDelta / 2) * (1 + pad);
  const halfLng = (region.longitudeDelta / 2) * (1 + pad);
  return [
    region.longitude - halfLng,
    region.latitude - halfLat,
    region.longitude + halfLng,
    region.latitude + halfLat,
  ];
}

/** Region delta that lands the viewport at a given slippy zoom (animateToRegion). */
export function zoomToRegionDelta(zoom: number): number {
  return 360 / Math.pow(2, Math.max(0, Math.min(20, zoom)));
}

/**
 * How many individual (unclustered) pins to show at a given zoom. Zoomed out =
 * only the most notable handful; zoomed in = progressively more. Clusters are
 * rendered on top of this and represent everything else, so nothing is "lost".
 * "Top ~100 at metro zoom" (decision 5-B) ≈ zoom 11–12.
 */
export function singletonCapForZoom(zoom: number): number {
  if (zoom <= 10) return 40;
  if (zoom <= 11) return 70;
  if (zoom <= 12) return 110;
  if (zoom <= 13) return 170;
  if (zoom <= 14) return 260;
  return 400;
}
