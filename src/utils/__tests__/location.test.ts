import { CHECK_IN_RADIUS_METERS, POST_FIRST_RADIUS_METERS } from "../../config/constants";

const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForegroundPermissionsAsync(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) =>
    mockGetCurrentPositionAsync(...args),
}));

import { verifyCheckInLocation, verifyPostLocation } from "../location";

// Event sits at the equator/prime-meridian so a pure latitude offset produces
// an exact haversine distance (Δλ = 0 removes the small-angle approximation).
const EVENT_LAT = 0;
const EVENT_LON = 0;
const EARTH_RADIUS_METERS = 6371e3;

function latOffsetForMeters(meters: number): number {
  return (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
}

function mockUserAt(meters: number) {
  mockGetForegroundPermissionsAsync.mockResolvedValue({ status: "granted" });
  mockGetCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: latOffsetForMeters(meters), longitude: EVENT_LON },
  });
}

beforeEach(() => {
  mockGetForegroundPermissionsAsync.mockReset();
  mockGetCurrentPositionAsync.mockReset();
});

describe("verifyPostLocation", () => {
  it("allows a user just inside the post-first radius", async () => {
    mockUserAt(POST_FIRST_RADIUS_METERS - 1);
    const result = await verifyPostLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(true);
  });

  it("allows a user exactly at the post-first radius boundary", async () => {
    mockUserAt(POST_FIRST_RADIUS_METERS);
    const result = await verifyPostLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(true);
  });

  it("denies a user just outside the post-first radius", async () => {
    mockUserAt(POST_FIRST_RADIUS_METERS + 1);
    const result = await verifyPostLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(false);
  });

  it("denies a user beyond the radius — post-first now matches the strict check-in radius", async () => {
    mockUserAt(CHECK_IN_RADIUS_METERS + 50);
    const result = await verifyPostLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(false);
  });

  it("returns allowed, user_lat, user_lng, and verified_at when allowed", async () => {
    mockUserAt(10);
    const result = await verifyPostLocation(EVENT_LAT, EVENT_LON);
    expect(result).toEqual(
      expect.objectContaining({
        allowed: true,
        user_lat: expect.any(Number),
        user_lng: expect.any(Number),
        verified_at: expect.any(String),
      }),
    );
  });
});

describe("verifyCheckInLocation (unchanged, strict 200m radius)", () => {
  it("allows a user just inside the check-in radius", async () => {
    mockUserAt(CHECK_IN_RADIUS_METERS - 1);
    const result = await verifyCheckInLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(true);
  });

  it("denies a user just outside the check-in radius", async () => {
    mockUserAt(CHECK_IN_RADIUS_METERS + 1);
    const result = await verifyCheckInLocation(EVENT_LAT, EVENT_LON);
    expect(result.allowed).toBe(false);
  });

  // (Post-first now shares the strict 200m radius, so there is no longer a
  // "within post-first but outside check-in" gap to assert.)

  it("returns allowed, user_lat, user_lng, and verified_at when allowed", async () => {
    mockUserAt(10);
    const result = await verifyCheckInLocation(EVENT_LAT, EVENT_LON);
    expect(result).toEqual(
      expect.objectContaining({
        allowed: true,
        user_lat: expect.any(Number),
        user_lng: expect.any(Number),
        verified_at: expect.any(String),
      }),
    );
  });
});
