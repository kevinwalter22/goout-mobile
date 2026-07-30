// Pure helpers for the map's marker selection. Kept separate from the React
// component so the zoom / threshold / collision math is unit-testable.
//
// Model (Apple-Maps style, not count-bubbles): show individual emoji pins,
// tiered by importance. Zoomed out shows only the most notable places; each
// zoom-in lowers the importance bar AND shrinks the collision grid, so MORE pins
// appear and — critically — a pin that's visible never disappears when you zoom
// in. Panning just slides pins in/out at the screen edges.

import type { MapRegion } from "../utils/mapViewport";

// Safety ceiling on how many native marker views we ever render at once. The
// collision grid already bounds this to roughly the number of cells on screen;
// this is just a hard backstop.
export const MAX_RENDERED_MARKERS = 140;

// We render markers for a ring padded beyond the viewport and let the map cull
// off-screen ones, so small pans don't require a recompute.
export const RENDER_PAD = 0.6;

// A collision cell is ~this fraction of the viewport wide (≈ one marker
// footprint). Smaller = more, tighter pins. Cells shrink with zoom, which is
// what makes hidden pins separate out and appear as you zoom in.
const MARKER_FOOTPRINT_FRACTION = 0.12;

/** react-native-maps longitudeDelta → integer slippy-map zoom (0–20). */
export function regionToZoom(region: MapRegion): number {
  const lngDelta = Math.max(region.longitudeDelta, 1e-6);
  const z = Math.log2(360 / lngDelta);
  return Math.max(0, Math.min(20, Math.round(z)));
}

/** [west, south, east, north] padded around the region (pad 0.6 → 60% larger). */
export function regionToPaddedBbox(
  region: MapRegion,
  pad = RENDER_PAD
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
 * Importance bar by zoom. Zoomed out (≤10) only the most notable (≥4.0) show;
 * by street zoom (≥16) everything qualifies. Monotonically decreasing, so a pin
 * that clears the bar at one zoom still clears it when you zoom in.
 * (notability_score in the data runs ~0–4.8.)
 */
export function notabilityThresholdForZoom(zoom: number): number {
  if (zoom <= 10) return 4.0;
  if (zoom >= 16) return 0;
  return (4.0 * (16 - zoom)) / 6;
}

/** Screen-consistent collision cell size (degrees). Halves each zoom-in. */
export function collisionCellSize(region: MapRegion): { lat: number; lng: number } {
  return {
    lat: Math.max(region.latitudeDelta * MARKER_FOOTPRINT_FRACTION, 1e-9),
    lng: Math.max(region.longitudeDelta * MARKER_FOOTPRINT_FRACTION, 1e-9),
  };
}

export type MapPoint = { id: string; lat: number; lng: number; notability: number };

/**
 * Choose which pins to render for the current region. Returns the ids to show,
 * most-notable-first. The `selectedId` pin is ALWAYS included (so tapping can
 * never make it vanish). Everything else must be in the padded viewport, clear
 * the zoom's importance bar, and win its collision cell (most notable wins; the
 * rest hide until a zoom-in separates them).
 */
export function selectVisiblePins(
  points: MapPoint[],
  region: MapRegion,
  selectedId: string | null,
  maxPins: number = MAX_RENDERED_MARKERS
): string[] {
  const threshold = notabilityThresholdForZoom(regionToZoom(region));
  const cell = collisionCellSize(region);
  const [w, s, e, n] = regionToPaddedBbox(region);

  const candidates = points.filter(
    (p) =>
      p.id === selectedId ||
      (p.lng >= w &&
        p.lng <= e &&
        p.lat >= s &&
        p.lat <= n &&
        p.notability >= threshold)
  );
  // Most notable first; the selected pin is pinned to the very front.
  candidates.sort((a, b) => {
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return b.notability - a.notability;
  });

  const taken = new Set<string>();
  const kept: string[] = [];
  for (const p of candidates) {
    const isSelected = p.id === selectedId;
    if (!isSelected && kept.length >= maxPins) break;
    const key = `${Math.floor(p.lat / cell.lat)}:${Math.floor(p.lng / cell.lng)}`;
    if (!isSelected && taken.has(key)) continue; // a more-notable pin owns this cell
    taken.add(key);
    kept.push(p.id);
  }
  return kept;
}
