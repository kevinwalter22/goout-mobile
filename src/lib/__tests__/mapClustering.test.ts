import {
  regionToZoom,
  regionToPaddedBbox,
  zoomToRegionDelta,
  singletonCapForZoom,
  MAX_RENDERED_MARKERS,
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
    expect(regionToZoom(region(0.01))).toBe(15); // street
    expect(regionToZoom(region(4))).toBe(6); // state-wide
  });
  it("clamps to 0..20 and never divides by zero", () => {
    const z = regionToZoom(region(0));
    expect(z).toBeGreaterThanOrEqual(0);
    expect(z).toBeLessThanOrEqual(20);
  });
});

describe("regionToPaddedBbox", () => {
  it("returns [w,s,e,n] with west<east and south<north", () => {
    const [w, s, e, n] = regionToPaddedBbox(region(0.08), 0.3);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });
  it("pads beyond the raw viewport", () => {
    const [w, , e] = regionToPaddedBbox(region(0.08), 0.3);
    // raw half-width is 0.04; padded half-width should exceed it
    expect((e - w) / 2).toBeGreaterThan(0.04);
  });
});

describe("zoomToRegionDelta", () => {
  it("round-trips with regionToZoom", () => {
    for (const z of [8, 10, 12, 14, 16]) {
      const delta = zoomToRegionDelta(z);
      expect(regionToZoom(region(delta))).toBe(z);
    }
  });
});

describe("singletonCapForZoom", () => {
  it("is monotonic non-decreasing with zoom", () => {
    let prev = -1;
    for (let z = 8; z <= 18; z++) {
      const cap = singletonCapForZoom(z);
      expect(cap).toBeGreaterThanOrEqual(prev);
      prev = cap;
    }
  });
  it("shows ~100 individual pins at metro zoom (decision 5-B)", () => {
    expect(singletonCapForZoom(12)).toBeGreaterThanOrEqual(90);
    expect(singletonCapForZoom(12)).toBeLessThanOrEqual(130);
  });
  it("never exceeds the hard render ceiling by itself at metro zoom", () => {
    expect(singletonCapForZoom(12)).toBeLessThan(MAX_RENDERED_MARKERS);
  });
});
