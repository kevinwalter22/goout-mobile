/**
 * Pure geometry helpers for the viewport-aware Explore map.
 *
 * The map shows "what I'm looking at": its data query is bounded by the visible
 * region rather than the user's GPS location. These helpers convert a map region
 * into a query bbox and decide when a new view is already covered by a prior
 * fetch (the containment-skip that avoids refetching on zoom-in / small pans).
 */

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface Bbox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

// Fetch a margin beyond the visible edges so markers near the border load too.
export const MAP_VIEWPORT_PADDING = 0.15;

/** Convert a map region into a query bbox, padded slightly beyond the edges. */
export function regionToBbox(r: MapRegion, padding = MAP_VIEWPORT_PADDING): Bbox {
  const latPad = (r.latitudeDelta / 2) * (1 + padding);
  const lngPad = (r.longitudeDelta / 2) * (1 + padding);
  return {
    latMin: r.latitude - latPad,
    latMax: r.latitude + latPad,
    lngMin: r.longitude - lngPad,
    lngMax: r.longitude + lngPad,
  };
}

/** Is bbox `inner` fully contained within bbox `outer`? */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner.latMin >= outer.latMin &&
    inner.latMax <= outer.latMax &&
    inner.lngMin >= outer.lngMin &&
    inner.lngMax <= outer.lngMax
  );
}
