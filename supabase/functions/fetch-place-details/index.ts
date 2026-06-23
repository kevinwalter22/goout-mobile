/**
 * Fetch Place Details — Lazy Loading Edge Function (Task 5)
 *
 * Called when a user views an explore item detail page for a Google Places item.
 * Checks the cache first; if missing or expired, calls Google Places Details API,
 * caches the result, and returns it.
 *
 * Request: POST { explore_item_id: string }
 * Response: { cached: boolean, details: PlaceDetails } or { details: null } for non-Places items
 *
 * Budget: Each call costs 1 Places Details request (~$0.017).
 * Cache TTL: 30 days (configured in migration 043).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth-guard.ts";

// Google Places API (New) — Place Details
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/";

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "websiteUri",
  "nationalPhoneNumber",
  "googleMapsUri",
  "photos",
  "reviews",
  "regularOpeningHours",
  "editorialSummary",
  "rating",
  "userRatingCount",
  "priceLevel",
].join(",");

interface PlaceDetails {
  website_uri: string | null;
  phone_number: string | null;
  google_maps_uri: string | null;
  photos: PhotoInfo[];
  reviews: ReviewInfo[];
  opening_hours: any | null;
  editorial_summary: string | null;
  rating: number | null;
  user_rating_count: number | null;
}

interface PhotoInfo {
  name: string;
  width: number;
  height: number;
}

interface ReviewInfo {
  author: string;
  rating: number;
  text: string;
  time: string;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  try {
    // Authenticate FIRST — before touching the (untrusted) request body. Parsing
    // an empty/invalid body before auth caused unauthenticated calls to 500
    // instead of returning a clean 401 (caught by the security regression suite).
    const { user, error: authError } = await requireUser(req);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: authError ?? "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let explore_item_id: string | undefined;
    try {
      ({ explore_item_id } = await req.json());
    } catch {
      explore_item_id = undefined;
    }

    if (!explore_item_id) {
      return new Response(
        JSON.stringify({ error: "Missing explore_item_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Service client for DB operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Look up the explore item to get external_id and verify it's a Google Places item
    const { data: item, error: itemError } = await supabase
      .from("explore_items")
      .select("id, external_id, source_id")
      .eq("id", explore_item_id)
      .single();

    if (itemError || !item) {
      return new Response(
        JSON.stringify({ error: "Item not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if this is a Google Places item (external_id starts with "places/" or "ChIJ")
    const externalId = item.external_id;
    if (
      !externalId ||
      (!externalId.startsWith("places/") && !externalId.startsWith("ChIJ"))
    ) {
      // Not a Google Places item — return null details
      return new Response(
        JSON.stringify({ details: null, cached: false, reason: "not_google_places" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check cache first
    const { data: cached } = await supabase
      .from("place_details_cache")
      .select("*")
      .eq("explore_item_id", explore_item_id)
      .single();

    if (cached && new Date(cached.expires_at) > new Date()) {
      // Cache hit and not expired
      return new Response(
        JSON.stringify({
          cached: true,
          details: {
            website_uri: cached.website_uri,
            phone_number: cached.phone_number,
            google_maps_uri: cached.google_maps_uri,
            photos: cached.photos || [],
            reviews: cached.reviews || [],
            opening_hours: cached.opening_hours,
            editorial_summary: cached.editorial_summary,
            rating: cached.rating,
            user_rating_count: cached.user_rating_count,
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Cache miss or expired — fetch from Google Places API
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Google Places API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Normalize the place ID for the API URL
    const placeResourceName = externalId.startsWith("places/")
      ? externalId
      : `places/${externalId}`;

    // Call Google Places API (New) — Place Details
    const detailsUrl = `${PLACE_DETAILS_URL}${placeResourceName}`;
    const response = await fetch(detailsUrl, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": DETAIL_FIELDS,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Places Details API error: ${response.status}`, errorText);

      // If we have stale cache, return it instead of failing
      if (cached) {
        return new Response(
          JSON.stringify({
            cached: true,
            stale: true,
            details: {
              website_uri: cached.website_uri,
              phone_number: cached.phone_number,
              google_maps_uri: cached.google_maps_uri,
              photos: cached.photos || [],
              reviews: cached.reviews || [],
              opening_hours: cached.opening_hours,
              editorial_summary: cached.editorial_summary,
              rating: cached.rating,
              user_rating_count: cached.user_rating_count,
            },
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({ error: "Failed to fetch place details" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const raw = await response.json();

    // Increment budget counter
    await supabase.rpc("increment_api_usage", {
      p_service: "google_places",
      p_count: 1,
    });

    // Extract and normalize details
    const details: PlaceDetails = {
      website_uri: raw.websiteUri || null,
      phone_number: raw.nationalPhoneNumber || null,
      google_maps_uri: raw.googleMapsUri || null,
      photos: (raw.photos || []).slice(0, 5).map((p: any) => ({
        name: p.name,
        width: p.widthPx || 0,
        height: p.heightPx || 0,
      })),
      reviews: (raw.reviews || []).slice(0, 5).map((r: any) => ({
        author: r.authorAttribution?.displayName || "Anonymous",
        rating: r.rating || 0,
        text: r.text?.text || "",
        time: r.publishTime || "",
      })),
      opening_hours: raw.regularOpeningHours || null,
      editorial_summary: raw.editorialSummary?.text || null,
      rating: raw.rating || null,
      user_rating_count: raw.userRatingCount || null,
    };

    // Upsert into cache
    const { error: upsertError } = await supabase
      .from("place_details_cache")
      .upsert(
        {
          explore_item_id,
          external_place_id: externalId,
          website_uri: details.website_uri,
          phone_number: details.phone_number,
          google_maps_uri: details.google_maps_uri,
          photos: details.photos,
          reviews: details.reviews,
          opening_hours: details.opening_hours,
          editorial_summary: details.editorial_summary,
          rating: details.rating,
          user_rating_count: details.user_rating_count,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "explore_item_id" },
      );

    if (upsertError) {
      console.error("Cache upsert error:", upsertError);
      // Non-fatal — still return the details
    }

    return new Response(
      JSON.stringify({ cached: false, details }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("fetch-place-details error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
