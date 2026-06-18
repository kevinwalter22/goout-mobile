import * as Location from "expo-location";
import { CHECK_IN_RADIUS_METERS } from "../config/constants";

// Conversion constants
const METERS_PER_MILE = 1609.344;

// ── Review account location override ───────────────────────────
// Downtown Potsdam, NY — Market St & Main St intersection
const REVIEW_LOCATION = { latitude: 44.6697, longitude: -74.9811 };
const REVIEW_EMAIL = "developer@euda.live";

// Module-level override: set by calling setLocationOverride()
let _overrideEmail: string | null = null;

/**
 * Call once after login to enable location override for the review account.
 * Pass null on sign-out to clear.
 */
export function setLocationOverride(email: string | null) {
  _overrideEmail = email;
}

function isReviewAccount(): boolean {
  return _overrideEmail === REVIEW_EMAIL;
}

/**
 * Returns true when the current user has a location override active.
 * Used by map components to hide native blue dot and show a custom marker.
 */
export function isLocationOverridden(): boolean {
  return isReviewAccount();
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
export function getDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in miles (for explore filters)
 */
export function getDistanceInMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return getDistanceInMeters(lat1, lon1, lat2, lon2) / METERS_PER_MILE;
}

/**
 * Get the current foreground location permission status without triggering a prompt.
 * Returns "granted", "denied", "undetermined", or "restricted".
 */
export async function getLocationPermissionStatus(): Promise<string> {
  if (isReviewAccount()) return "granted";
  const { status } = await Location.getForegroundPermissionsAsync();
  return status;
}

/**
 * Request location permissions from the user.
 * Returns `denied: true` when the user has previously denied permission
 * and the OS will no longer show the permission prompt.
 */
export async function requestLocationPermission(): Promise<{
  granted: boolean;
  denied?: boolean;
  error?: string;
}> {
  // Review account always has "permission"
  if (isReviewAccount()) return { granted: true };

  try {
    // Check current status without triggering a prompt
    const { status: currentStatus } =
      await Location.getForegroundPermissionsAsync();

    if (currentStatus === "granted") {
      return { granted: true };
    }

    // Already denied — OS won't re-prompt, user must go to Settings
    if (currentStatus === "denied") {
      return {
        granted: false,
        denied: true,
        error: "Location permission was denied. Please enable it in Settings.",
      };
    }

    // Status is undetermined — show the system permission prompt
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      return { granted: true };
    }

    // User just denied the prompt
    return {
      granted: false,
      denied: true,
      error: "Location permission is required to check in",
    };
  } catch (_error) {
    return {
      granted: false,
      error: "Failed to request location permission",
    };
  }
}

/**
 * Get current location of the user
 */
export async function getCurrentLocation(): Promise<{
  latitude: number;
  longitude: number;
  error?: string;
}> {
  // Review account: always downtown Potsdam
  if (isReviewAccount()) return REVIEW_LOCATION;

  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (_error) {
    return {
      latitude: 0,
      longitude: 0,
      error: "Failed to get current location",
    };
  }
}

/**
 * Check if user is within check-in radius of event location
 */
export function isWithinCheckInRadius(
  userLat: number,
  userLon: number,
  eventLat: number,
  eventLon: number,
): boolean {
  const distance = getDistanceInMeters(userLat, userLon, eventLat, eventLon);
  return distance <= CHECK_IN_RADIUS_METERS;
}

/**
 * Verify user can check in at event location.
 *
 * When `allowed` is true, the return also carries the sampled coordinates
 * and the wall-clock time the gate ran. The caller is expected to thread
 * these through the check-in flow to the post insert so the geo+time
 * invariant becomes auditable: posts.verified_lat / verified_lng /
 * verified_at / verified_at_event are required by the BEFORE INSERT
 * trigger added in migration 137.
 */
export interface VerifyCheckInResult {
  allowed: boolean;
  distance?: number;
  denied?: boolean;
  error?: string;
  /** Sampled user coords. Present iff allowed === true. */
  user_lat?: number;
  user_lng?: number;
  /** ISO timestamp marking when the gate ran. Present iff allowed === true. */
  verified_at?: string;
}

export async function verifyCheckInLocation(
  eventLat: number,
  eventLon: number,
): Promise<VerifyCheckInResult> {
  // Request permission
  const { granted, denied, error: permError } =
    await requestLocationPermission();
  if (!granted) {
    return { allowed: false, denied, error: permError };
  }

  // Get current location
  const { latitude, longitude, error: locError } = await getCurrentLocation();
  if (locError) {
    return { allowed: false, error: locError };
  }

  // Check distance
  const distance = getDistanceInMeters(latitude, longitude, eventLat, eventLon);
  const allowed = distance <= CHECK_IN_RADIUS_METERS;

  if (!allowed) {
    return {
      allowed: false,
      distance: Math.round(distance),
      error: `You need to be closer to check in (${Math.round(distance)}m away)`,
    };
  }

  return {
    allowed: true,
    distance: Math.round(distance),
    user_lat: latitude,
    user_lng: longitude,
    verified_at: new Date().toISOString(),
  };
}
