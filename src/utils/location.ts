import * as Location from "expo-location";
import { CHECK_IN_RADIUS_METERS } from "../config/constants";

// Conversion constants
const METERS_PER_MILE = 1609.344;

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
 * Request location permissions from the user.
 * Returns `denied: true` when the user has previously denied permission
 * and the OS will no longer show the permission prompt.
 */
export async function requestLocationPermission(): Promise<{
  granted: boolean;
  denied?: boolean;
  error?: string;
}> {
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
 * Verify user can check in at event location
 */
export async function verifyCheckInLocation(
  eventLat: number,
  eventLon: number,
): Promise<{
  allowed: boolean;
  distance?: number;
  denied?: boolean;
  error?: string;
}> {
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

  return {
    allowed,
    distance: Math.round(distance),
    error: allowed
      ? undefined
      : `You need to be closer to check in (${Math.round(distance)}m away)`,
  };
}
