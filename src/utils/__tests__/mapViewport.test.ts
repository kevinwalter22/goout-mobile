import { regionToBbox, bboxContains, type MapRegion } from "../mapViewport";

const region = (
  latitude: number,
  longitude: number,
  latitudeDelta: number,
  longitudeDelta: number,
): MapRegion => ({ latitude, longitude, latitudeDelta, longitudeDelta });

describe("regionToBbox", () => {
  it("derives a padded bbox centered on the region", () => {
    // Portland, ME-ish region, 0.1° tall/wide, default 15% padding.
    const b = regionToBbox(region(43.6591, -70.2568, 0.1, 0.1));
    const pad = (0.1 / 2) * 1.15; // 0.0575
    expect(b.latMin).toBeCloseTo(43.6591 - pad, 6);
    expect(b.latMax).toBeCloseTo(43.6591 + pad, 6);
    expect(b.lngMin).toBeCloseTo(-70.2568 - pad, 6);
    expect(b.lngMax).toBeCloseTo(-70.2568 + pad, 6);
  });

  it("honors a custom padding (0 = exact viewport)", () => {
    const b = regionToBbox(region(40, -74, 0.2, 0.4), 0);
    expect(b.latMin).toBeCloseTo(39.9, 6);
    expect(b.latMax).toBeCloseTo(40.1, 6);
    expect(b.lngMin).toBeCloseTo(-74.2, 6);
    expect(b.lngMax).toBeCloseTo(-73.8, 6);
  });
});

describe("bboxContains", () => {
  const outer = regionToBbox(region(43.6591, -70.2568, 0.2, 0.2));

  it("returns true when zooming in (inner ⊂ outer)", () => {
    const inner = regionToBbox(region(43.6591, -70.2568, 0.05, 0.05));
    expect(bboxContains(outer, inner)).toBe(true);
  });

  it("returns false when panning to a new area (inner escapes outer)", () => {
    const panned = regionToBbox(region(43.9, -70.0, 0.05, 0.05));
    expect(bboxContains(outer, panned)).toBe(false);
  });

  it("returns false when zooming out (inner larger than outer)", () => {
    const zoomedOut = regionToBbox(region(43.6591, -70.2568, 0.5, 0.5));
    expect(bboxContains(outer, zoomedOut)).toBe(false);
  });

  it("a bbox contains itself", () => {
    expect(bboxContains(outer, outer)).toBe(true);
  });
});
