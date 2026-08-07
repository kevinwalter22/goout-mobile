import { nearestRepId } from "../mapTap";

const feat = (repId: string, lng: number, lat: number) => ({
  geometry: { coordinates: [lng, lat] as [number, number] },
  properties: { repId },
});

describe("nearestRepId (tap disambiguation)", () => {
  it("returns undefined when nothing was tapped", () => {
    expect(nearestRepId([], { latitude: 0, longitude: 0 })).toBeUndefined();
    expect(nearestRepId(undefined, { latitude: 0, longitude: 0 })).toBeUndefined();
  });

  it("returns the only feature's repId regardless of tap", () => {
    expect(nearestRepId([feat("A", -70.25, 43.66)], { latitude: 43.7, longitude: -70.3 })).toBe("A");
  });

  it("picks the CLOSEST pin to the tap, not features[0]", () => {
    // A is first in the array but B is closer to the tap → must return B.
    const features = [feat("A", -70.2600, 43.6600), feat("B", -70.2500, 43.6500)];
    const tapNearB = { latitude: 43.6502, longitude: -70.2503 };
    expect(nearestRepId(features, tapNearB)).toBe("B");
  });

  it("still picks the closest when the array order favors a far pin", () => {
    const features = [feat("far", -70.30, 43.70), feat("near", -70.2501, 43.6601)];
    const tap = { latitude: 43.66, longitude: -70.25 };
    expect(nearestRepId(features, tap)).toBe("near");
  });

  it("falls back to features[0] when no tap coordinate is available", () => {
    const features = [feat("A", -70.26, 43.66), feat("B", -70.25, 43.65)];
    expect(nearestRepId(features, undefined)).toBe("A");
  });

  it("skips features missing coordinates without crashing", () => {
    const features = [
      { properties: { repId: "noGeo" } },
      feat("hasGeo", -70.25, 43.66),
    ];
    expect(nearestRepId(features, { latitude: 43.66, longitude: -70.25 })).toBe("hasGeo");
  });
});
