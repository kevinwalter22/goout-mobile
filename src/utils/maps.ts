/**
 * Map Linking Utilities
 *
 * Opens native map apps for navigation to a location.
 * - iOS: Opens Apple Maps (preferred) or falls back to Google Maps
 * - Android: Opens Google Maps or system app chooser
 */

import { Alert, Linking, Platform } from "react-native";

interface OpenMapsOptions {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string | null;
}

/**
 * Open the native maps app with directions to a location.
 *
 * Priority:
 * 1. Use lat/lng coordinates if available (most accurate)
 * 2. Fall back to address string for geocoding
 *
 * Platform behavior:
 * - iOS: Opens Apple Maps by default
 * - Android: Opens Google Maps or system chooser
 */
export async function openDirections(options: OpenMapsOptions): Promise<void> {
  const { lat, lng, address, label } = options;

  // Check if we have any location data
  if ((lat == null || lng == null) && !address) {
    Alert.alert(
      "Location Not Available",
      "This item doesn't have location information for directions."
    );
    return;
  }

  try {
    if (Platform.OS === "ios") {
      await openAppleMaps({ lat, lng, address, label });
    } else if (Platform.OS === "android") {
      await openGoogleMaps({ lat, lng, address, label });
    } else {
      // Web fallback - open Google Maps in browser
      await openGoogleMapsWeb({ lat, lng, address, label });
    }
  } catch (error) {
    console.error("[Maps] Failed to open maps:", error);
    Alert.alert(
      "Could Not Open Maps",
      "Unable to open the maps app. Please try again."
    );
  }
}

/**
 * Open Apple Maps (iOS)
 * URL scheme: https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html
 */
async function openAppleMaps(options: OpenMapsOptions): Promise<void> {
  const { lat, lng, address, label } = options;

  let url: string;

  if (lat != null && lng != null) {
    // Use coordinates for precise navigation
    // daddr = destination address, dirflg=d for driving directions
    const destination = `${lat},${lng}`;
    const encodedLabel = label ? encodeURIComponent(label) : "";
    url = `maps://maps.apple.com/?daddr=${destination}&q=${encodedLabel}`;
  } else if (address) {
    // Fall back to address geocoding
    const encodedAddress = encodeURIComponent(address);
    url = `maps://maps.apple.com/?daddr=${encodedAddress}`;
  } else {
    throw new Error("No location data available");
  }

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  } else {
    // Fall back to Google Maps if Apple Maps not available
    await openGoogleMapsWeb(options);
  }
}

/**
 * Open Google Maps (Android)
 * URL scheme: https://developers.google.com/maps/documentation/urls/android-intents
 */
async function openGoogleMaps(options: OpenMapsOptions): Promise<void> {
  const { lat, lng, address, label } = options;

  let url: string;

  if (lat != null && lng != null) {
    // Use coordinates for precise navigation
    // google.navigation launches turn-by-turn navigation
    url = `google.navigation:q=${lat},${lng}`;

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return;
    }

    // Fall back to geo: URI which opens map chooser
    const encodedLabel = label ? `(${encodeURIComponent(label)})` : "";
    url = `geo:${lat},${lng}?q=${lat},${lng}${encodedLabel}`;
  } else if (address) {
    // Use address for geocoding
    const encodedAddress = encodeURIComponent(address);
    url = `geo:0,0?q=${encodedAddress}`;
  } else {
    throw new Error("No location data available");
  }

  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  } else {
    // Fall back to web Google Maps
    await openGoogleMapsWeb(options);
  }
}

/**
 * Open Google Maps in web browser (fallback)
 */
async function openGoogleMapsWeb(options: OpenMapsOptions): Promise<void> {
  const { lat, lng, address, label } = options;

  let url: string;

  if (lat != null && lng != null) {
    // Use coordinates
    url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  } else if (address) {
    // Use address
    const encodedAddress = encodeURIComponent(address);
    url = `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
  } else {
    throw new Error("No location data available");
  }

  await Linking.openURL(url);
}

/**
 * Check if the device has location data for an item
 */
export function hasLocationData(item: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}): boolean {
  return (item.lat != null && item.lng != null) || !!item.address;
}
