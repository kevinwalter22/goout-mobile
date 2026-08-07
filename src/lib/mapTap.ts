// Pure tap-disambiguation helpers for the map (no native deps → unit-testable).

type TapFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { repId?: string };
};

/**
 * A map tap carries every feature within the ~44px hitbox, which in dense areas
 * is several pins. Return the repId of the one whose point is closest to the
 * actual tap, so a tap selects the pin you aimed at — not an arbitrary neighbor
 * (which is what picking `features[0]` did).
 */
export function nearestRepId(
  features: TapFeature[] | undefined,
  tap: { latitude: number; longitude: number } | undefined
): string | undefined {
  if (!features || features.length === 0) return undefined;
  if (features.length === 1 || !tap) return features[0]?.properties?.repId;
  let best: TapFeature | undefined;
  let bestD = Infinity;
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    if (!c) continue;
    const dLng = c[0] - tap.longitude;
    const dLat = c[1] - tap.latitude;
    const d = dLng * dLng + dLat * dLat;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return (best ?? features[0])?.properties?.repId;
}
