/**
 * applyDistanceFilter coverage — the client-side distance gate that also
 * enforces the STRICT null-coordinate exclusion.
 *
 * Why this matters: the live monitoring snapshot shows ~45 null-coord events.
 * The gate is what keeps those (and out-of-region events) from leaking into a
 * located user's feed. The behaviors locked down here:
 *   - 50mi architectural floor even when distance = "any"
 *   - strict drop of any item missing lat/lng (when not searching)
 *   - explicit narrower radius respected
 *   - active search disables the gate entirely (and keeps null-coord items)
 *   - distance sort with the (starts_at, id) tie-breaker, null-coords last
 */
import { applyDistanceFilter } from "../exploreQuery";

const USER = { lat: 41.2557, lng: -74.3601 }; // Warwick, NY

// ~69 miles per degree of latitude → predictable separations.
const near = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, lat: USER.lat, lng: USER.lng, ...extra }); // ~0 mi
const midFar = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, lat: USER.lat + 0.2, lng: USER.lng, ...extra }); // ~13.8 mi
const veryFar = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, lat: USER.lat + 2, lng: USER.lng, ...extra }); // ~138 mi
const nullCoord = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, lat: null, lng: null, ...extra });

const filters = (o: Record<string, unknown> = {}) =>
  ({ distance: "any", searchQuery: "", sort: "relevance", ...o }) as any;

describe("applyDistanceFilter — no-op conditions", () => {
  it("returns data unchanged when there is no user location", () => {
    const data = [near("a"), nullCoord("b")];
    expect(applyDistanceFilter(data, null, filters())).toBe(data);
  });

  it("returns empty array unchanged", () => {
    const out = applyDistanceFilter([], USER, filters());
    expect(out).toEqual([]);
  });
});

describe("applyDistanceFilter — strict null-coord gate", () => {
  it("drops null-coord items even when distance is 'any'", () => {
    const out = applyDistanceFilter([near("keep"), nullCoord("drop")], USER, filters());
    expect(out.map((i) => i.id)).toEqual(["keep"]);
  });

  it("applies the 50mi architectural floor when distance is 'any'", () => {
    const out = applyDistanceFilter(
      [near("in"), midFar("alsoIn"), veryFar("out")],
      USER,
      filters({ distance: "any" }),
    );
    expect(out.map((i) => i.id).sort()).toEqual(["alsoIn", "in"]);
  });
});

describe("applyDistanceFilter — explicit radius", () => {
  it("respects a narrower 5mi radius", () => {
    const out = applyDistanceFilter(
      [near("in"), midFar("out13mi")],
      USER,
      filters({ distance: 5 }),
    );
    expect(out.map((i) => i.id)).toEqual(["in"]);
  });

  it("keeps items within an explicit 25mi radius", () => {
    const out = applyDistanceFilter(
      [near("in"), midFar("in14mi"), veryFar("out138mi")],
      USER,
      filters({ distance: 25 }),
    );
    expect(out.map((i) => i.id).sort()).toEqual(["in", "in14mi"]);
  });
});

describe("applyDistanceFilter — active search disables the gate", () => {
  it("does not filter by distance and keeps null-coord items when searching", () => {
    const data = [near("a"), veryFar("b"), nullCoord("c")];
    const out = applyDistanceFilter(data, USER, filters({ searchQuery: "starbucks" }));
    expect(out.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("applyDistanceFilter — distance sort", () => {
  it("sorts ascending by distance", () => {
    const out = applyDistanceFilter(
      [veryFar("far"), near("near"), midFar("mid")],
      USER,
      filters({ distance: "any", sort: "distance" }),
    );
    // veryFar is beyond the 50mi floor so it's filtered out; remaining sorted.
    expect(out.map((i) => i.id)).toEqual(["near", "mid"]);
  });

  it("breaks ties by starts_at then id, pushing null-coords last", () => {
    // Searching disables filtering so null-coord items survive to be sorted.
    const a = near("a", { starts_at: "2026-01-02T00:00:00Z" });
    const b = near("b", { starts_at: "2026-01-01T00:00:00Z" }); // earlier → first
    const n = nullCoord("z");
    const out = applyDistanceFilter([a, n, b], USER, filters({ searchQuery: "x", sort: "distance" }));
    expect(out.map((i) => i.id)).toEqual(["b", "a", "z"]);
  });
});
