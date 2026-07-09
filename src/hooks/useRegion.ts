/**
 * Region hook — resolves the ONE active metro the feed is scoped to.
 *
 * Fallback ladder (Tier 2 region model; see docs/design/tier2_recurrence_region.md):
 *   1. explicit manual pick (switcher) — persisted, wins when set
 *   2. live GPS            → nearest active region
 *   3. last-known GPS      → nearest active region  (handled upstream: userLocation
 *                            is already seeded from last-known before GPS resolves)
 *   4. nothing resolvable  → needsPicker = true ("Pick your city", never unscoped)
 *
 * When a location resolves OUTSIDE every region (a traveler), we still return the
 * NEAREST active region (B3) so the feed is never empty — the switcher lets them
 * change it. Cross-metro bleed is impossible: the server applies region_id as a
 * hard filter; this hook only decides WHICH region.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import { getDistanceInMiles } from "../utils/location";

export interface Region {
  id: string;
  slug: string;
  name: string;
  center_lat: number;
  center_lng: number;
  radius_miles: number;
  min_lat: number | null;
  max_lat: number | null;
  min_lng: number | null;
  max_lng: number | null;
  display_order: number;
}

const MANUAL_REGION_KEY = "@euda_region_id";

/** Nearest active region to a point (bbox containment preferred, else nearest center). */
export function resolveRegionForLocation(
  regions: Region[],
  loc: { lat: number; lng: number },
): Region | null {
  if (regions.length === 0) return null;
  let best: Region | null = null;
  let bestScore = Infinity;
  for (const r of regions) {
    const inBbox =
      r.min_lat != null &&
      r.max_lat != null &&
      r.min_lng != null &&
      r.max_lng != null &&
      loc.lat >= r.min_lat &&
      loc.lat <= r.max_lat &&
      loc.lng >= r.min_lng &&
      loc.lng <= r.max_lng;
    const dist = getDistanceInMiles(loc.lat, loc.lng, r.center_lat, r.center_lng);
    // bbox hit ranks ahead of any center distance
    const score = inBbox ? -1 : dist;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

export interface UseRegionReturn {
  regions: Region[];
  activeRegion: Region | null;
  activeRegionId: string | null;
  /** Explicit switcher pick (persists, overrides GPS). Pass null to clear → follow location. */
  setRegion: (regionId: string | null) => void;
  /** True when we can't resolve a region and have no manual pick → show the picker. */
  needsPicker: boolean;
  loading: boolean;
}

export function useRegion(
  userLocation?: { lat: number; lng: number } | null,
  opts?: { locationSettled?: boolean },
): UseRegionReturn {
  // GPS-first: only fall through to the manual picker once the live-GPS attempt
  // has settled (granted+resolved, denied, or errored). Until then we wait —
  // the picker is a fallback, never the default. Defaults to true so callers
  // that don't pass it keep the old (immediate) behavior.
  const locationSettled = opts?.locationSettled ?? true;
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualRegionId, setManualRegionId] = useState<string | null>(null);
  const [manualLoaded, setManualLoaded] = useState(false);

  // Load regions once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("region")
        .select("*")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (!cancelled) {
        setRegions((data as Region[]) || []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load persisted manual pick once.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(MANUAL_REGION_KEY).then((v) => {
      if (!cancelled) {
        setManualRegionId(v || null);
        setManualLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setRegion = useCallback((regionId: string | null) => {
    setManualRegionId(regionId);
    if (regionId) void AsyncStorage.setItem(MANUAL_REGION_KEY, regionId);
    else void AsyncStorage.removeItem(MANUAL_REGION_KEY);
  }, []);

  const activeRegion = useMemo<Region | null>(() => {
    if (regions.length === 0) return null;
    // 1. explicit manual pick wins
    if (manualRegionId) {
      const m = regions.find((r) => r.id === manualRegionId);
      if (m) return m;
    }
    // 2/3. resolve from location (live GPS, or last-known already seeded upstream)
    if (userLocation) return resolveRegionForLocation(regions, userLocation);
    // 4. nothing resolvable
    return null;
  }, [regions, manualRegionId, userLocation]);

  // Only claim "needs picker" once regions + persisted pick have loaded, the
  // live-GPS attempt has settled, and we STILL can't resolve a region. This
  // ordering enforces the ladder — live GPS → last-known → saved → picker — so
  // the picker never pre-empts an in-flight GPS fix on cold start.
  const needsPicker =
    !loading &&
    manualLoaded &&
    locationSettled &&
    regions.length > 0 &&
    activeRegion == null;

  return {
    regions,
    activeRegion,
    activeRegionId: activeRegion?.id ?? null,
    setRegion,
    needsPicker,
    loading,
  };
}
