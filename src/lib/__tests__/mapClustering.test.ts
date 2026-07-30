import {
  regionToZoom,
  regionToPaddedBbox,
  zoomToRegionDelta,
  notabilityThresholdForZoom,
  selectVisiblePins,
  MAX_RENDERED_MARKERS,
  type MapPoint,
} from "../mapClustering";

const region = (latitudeDelta: number, longitudeDelta = latitudeDelta) => ({
  latitude: 43.66,
  longitude: -70.25,
  latitudeDelta,
  longitudeDelta,
});

describe("regionToZoom", () => {
  it("maps metro/street spans to sensible slippy zooms", () => {
    expect(regionToZoom(region(0.08))).toBe(12); // metro
    expect(regionToZoom(region(0.02))).toBe(14); // neighborhood
    expect(regionToZoom(region(4))).toBe(6); // state-wide
  });
});

describe("regionToPaddedBbox", () => {
  it("returns [w,s,e,n] with west<east and south<north, padded beyond viewport", () => {
    const [w, s, e, n] = regionToPaddedBbox(region(0.08));
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
    expect((e - w) / 2).toBeGreaterThan(0.04); // wider than the raw half-width
  });
});

describe("zoomToRegionDelta", () => {
  it("round-trips with regionToZoom", () => {
    for (const z of [8, 10, 12, 14, 16]) {
      expect(regionToZoom(region(zoomToRegionDelta(z)))).toBe(z);
    }
  });
});

describe("notabilityThresholdForZoom", () => {
  it("is monotonically decreasing (zoom in → lower bar → more pins)", () => {
    let prev = Infinity;
    for (let z = 8; z <= 18; z++) {
      const t = notabilityThresholdForZoom(z);
      expect(t).toBeLessThanOrEqual(prev);
      prev = t;
    }
  });
  it("only the most notable at zoom-out, everything at street zoom", () => {
    expect(notabilityThresholdForZoom(10)).toBe(4.0);
    expect(notabilityThresholdForZoom(16)).toBe(0);
  });
});

describe("selectVisiblePins", () => {
  // A = very notable @ center; B = low notability, near center (in view at all
  // zooms); C/D collide in one cell at metro zoom.
  const A: MapPoint = { id: "A", lat: 43.66, lng: -70.25, notability: 5 };
  const B: MapPoint = { id: "B", lat: 43.658, lng: -70.248, notability: 1 };
  const C: MapPoint = { id: "C", lat: 43.665, lng: -70.255, notability: 4 };
  const D: MapPoint = { id: "D", lat: 43.6655, lng: -70.2555, notability: 3 };
  const pts = [A, B, C, D];

  it("hides sub-threshold pins when zoomed out, reveals them on zoom-in", () => {
    const metro = selectVisiblePins(pts, region(0.08), null); // zoom 12, thr 2.67
    expect(metro).toContain("A");
    expect(metro).not.toContain("B"); // notability 1 < 2.67
    const street = selectVisiblePins(pts, region(0.011), null); // zoom 15, thr ~0.67
    expect(street).toContain("B"); // 1 >= 0.67 → now visible
  });

  it("collision: only the most-notable pin in a cell shows", () => {
    const metro = selectVisiblePins(pts, region(0.08), null);
    expect(metro).toContain("C"); // notability 4 wins the cell
    expect(metro).not.toContain("D"); // 3, same cell → hidden
  });

  it("zoom-in is additive: the hidden collider separates out and appears", () => {
    const zoomedIn = selectVisiblePins(pts, region(0.02), null); // zoom 14, finer cells
    expect(zoomedIn).toContain("C");
    expect(zoomedIn).toContain("D"); // now in its own cell
  });

  it("MONOTONIC zoom-in: a visible pin never disappears when zooming in (the bug)", () => {
    // A tight cluster (Kevin's "5 drink icons"): all stay inside the viewport at
    // every tested zoom, so the ONLY reason one could vanish would be the cell
    // grid — which the nesting fix forbids.
    const cluster: MapPoint[] = [];
    for (let i = 0; i < 12; i++) {
      cluster.push({
        id: `bar${i}`,
        lat: 43.657 + (i % 4) * 0.0015,
        lng: -70.253 + Math.floor(i / 4) * 0.0018,
        notability: 2 + ((i * 7) % 5) * 0.4, // varied, all >= 2 (clears threshold ≤ zoom 13)
      });
    }
    const zoomsWideToTight = [0.16, 0.08, 0.04, 0.02]; // ~zoom 11 → 14
    let prevVisible = new Set(selectVisiblePins(cluster, region(zoomsWideToTight[0]), null));
    for (let k = 1; k < zoomsWideToTight.length; k++) {
      const nowVisible = new Set(selectVisiblePins(cluster, region(zoomsWideToTight[k]), null));
      // everything visible when zoomed out must still be visible zoomed in
      for (const id of prevVisible) expect(nowVisible.has(id)).toBe(true);
      // and zooming in should never show fewer
      expect(nowVisible.size).toBeGreaterThanOrEqual(prevVisible.size);
      prevVisible = nowVisible;
    }
  });

  it("ALWAYS includes the selected pin — even below threshold or in a taken cell", () => {
    const sel = selectVisiblePins(pts, region(0.08), "B"); // B is sub-threshold
    expect(sel).toContain("B");
    const selD = selectVisiblePins(pts, region(0.08), "D"); // D collides with C
    expect(selD).toContain("D"); // the selected pin always shows (its neighbor may hide)
  });

  it("never exceeds the render cap (except the forced selected pin)", () => {
    const many: MapPoint[] = [];
    for (let i = 0; i < 5000; i++) {
      many.push({ id: `p${i}`, lat: 43.6 + (i % 100) * 0.001, lng: -70.3 + Math.floor(i / 100) * 0.001, notability: 5 });
    }
    const out = selectVisiblePins(many, region(0.5), null, 50);
    expect(out.length).toBeLessThanOrEqual(50);
  });
});

describe("MAX_RENDERED_MARKERS", () => {
  it("is a sane backstop", () => {
    expect(MAX_RENDERED_MARKERS).toBeGreaterThan(50);
    expect(MAX_RENDERED_MARKERS).toBeLessThan(400);
  });
});
