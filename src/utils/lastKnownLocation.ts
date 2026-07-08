/**
 * Last-known location persistence.
 *
 * The explore feed is metro-scoped by distance from the user's location. When
 * live GPS is unavailable (permission not yet granted, or GPS still resolving on
 * cold start), the feed falls back to the last location we successfully sampled
 * so it stays scoped to ONE metro and never bleeds across regions. This is
 * layer 2 of the region fallback ladder:
 *   1. live GPS  →  2. last-known (here)  →  3. manual metro picker (Tier 2).
 *
 * Kept in its own module (not utils/location.ts) so the AsyncStorage import
 * doesn't get pulled transitively into scoring.ts and the Jest test graph.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAST_KNOWN_LOCATION_KEY = "@euda_last_known_location";

export async function saveLastKnownLocation(loc: {
  lat: number;
  lng: number;
}): Promise<void> {
  try {
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    if (loc.lat === 0 && loc.lng === 0) return; // getCurrentLocation error sentinel
    await AsyncStorage.setItem(LAST_KNOWN_LOCATION_KEY, JSON.stringify(loc));
  } catch (_e) {
    // Non-fatal: last-known is a convenience fallback.
  }
}

export async function loadLastKnownLocation(): Promise<{
  lat: number;
  lng: number;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KNOWN_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      !(parsed.lat === 0 && parsed.lng === 0)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
    return null;
  } catch (_e) {
    return null;
  }
}
