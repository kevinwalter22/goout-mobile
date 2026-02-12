/**
 * usePlaceDetails — lazy-loads Google Places details on first view.
 *
 * Calls the fetch-place-details edge function which checks cache first,
 * then falls back to Google Places API if needed.
 *
 * Returns null for non-Google-Places items (Ticketmaster events, curated items).
 */

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export interface PlaceDetails {
  website_uri: string | null;
  phone_number: string | null;
  google_maps_uri: string | null;
  photos: { name: string; width: number; height: number }[];
  reviews: { author: string; rating: number; text: string; time: string }[];
  opening_hours: any | null;
  editorial_summary: string | null;
  rating: number | null;
  user_rating_count: number | null;
}

interface UsePlaceDetailsResult {
  details: PlaceDetails | null;
  loading: boolean;
  error: string | null;
  cached: boolean;
}

export function usePlaceDetails(
  exploreItemId: string | undefined,
): UsePlaceDetailsResult {
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    if (!exploreItemId) return;

    let cancelled = false;

    async function fetchDetails() {
      setLoading(true);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "fetch-place-details",
          { body: { explore_item_id: exploreItemId } },
        );

        if (cancelled) return;

        if (fnError) {
          setError(fnError.message);
          return;
        }

        if (data?.details) {
          setDetails(data.details);
          setCached(data.cached ?? false);
        } else {
          // Not a Google Places item or no details available
          setDetails(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load details");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDetails();

    return () => {
      cancelled = true;
    };
  }, [exploreItemId]);

  return { details, loading, error, cached };
}
