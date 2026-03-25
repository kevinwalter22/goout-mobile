/**
 * Module-level callback store for the location picker screen.
 * The caller registers a callback before pushing to /location-picker;
 * the picker resolves it when the user confirms a pin location.
 */

type LocationResult = { lat: number; lng: number };
type LocationCallback = (result: LocationResult) => void;

let pendingCallback: LocationCallback | null = null;

export function setLocationPickerCallback(cb: LocationCallback): void {
  pendingCallback = cb;
}

export function resolveLocationPicker(result: LocationResult): void {
  pendingCallback?.(result);
  pendingCallback = null;
}

export function cancelLocationPicker(): void {
  pendingCallback = null;
}
