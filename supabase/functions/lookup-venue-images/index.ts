/**
 * Lookup Venue Images — Find images for items without source-provided photos
 *
 * Uses Google Places Text Search to find the venue by name + location,
 * then fetches and caches the venue photo in Supabase Storage.
 *
 * Strategy per item:
 * 1. Text Search by location_name + town with lat/lng bias
 * 2. Fuzzy-match returned place name against item location_name/title
 * 3. If confidence >= 0.6: fetch photo, cache to Storage, update DB
 * 4. If no match: mark_image_search_attempted() to avoid re-trying
 *
 * Request: POST { max_items?: number, dry_run?: boolean }
 * Response: { processed, matched, cached, no_match, errors[], stats }
 *
 * Cost: ~$0.032 (Text Search) + ~$0.007 (Photo) = ~$0.039/item
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_API_BASE = "https://places.googleapis.com/v1/";
const BUCKET_NAME = "explore-images";
const FULL_SIZE = { maxWidth: 1200, maxHeight: 800 };
const THUMB_SIZE = { maxWidth: 400, maxHeight: 300 };
const CONFIDENCE_THRESHOLD = 0.6;

interface ItemNeedingImage {
  id: string;
  external_id: string;
  title: string;
  source_type: string;
  location_name: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
}

interface ProcessResult {
  processed: number;
  matched: number;
  cached: number;
  no_match: number;
  no_location: number;
  errors: string[];
}

/**
 * Fuzzy name match using token overlap.
 * Returns 0.0 - 1.0 confidence score.
 */
function nameMatchConfidence(itemName: string, placeName: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const a = normalize(itemName);
  const b = normalize(placeName);

  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const tokensA = new Set(a.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 2));

  if (tokensA.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }

  return overlap / Math.max(tokensA.size, 1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const maxItems = Math.min(body.max_items || 25, 100);
    const dryRun = body.dry_run || false;
    const sourceType = body.source_type || null; // e.g. "curated_csv"

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_PLACES_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch items needing images, optionally filtered by source type
    // Pass source_type to exclude Google Places items (they use cache-place-photos)
    const rpcParams: Record<string, any> = { p_limit: maxItems };
    if (sourceType) {
      rpcParams.p_source_type = sourceType;
    }

    const { data: items, error: itemsError } = await supabase.rpc(
      "get_items_needing_images",
      rpcParams,
    );

    if (itemsError) {
      console.error("Error fetching items:", itemsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch items needing images" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          matched: 0,
          cached: 0,
          no_match: 0,
          no_location: 0,
          errors: [],
          message: "No items need image lookup",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const result: ProcessResult = {
      processed: 0,
      matched: 0,
      cached: 0,
      no_match: 0,
      no_location: 0,
      errors: [],
    };

    let apiCallCount = 0;
    let skippedGooglePlaces = 0;

    for (const item of items as ItemNeedingImage[]) {
      result.processed++;

      try {
        // Track Google Places items but still process them
        // (they may not have had photos via cache-place-photos,
        // but a text search might find a different matching place)
        if (item.source_type === "api_google_places") {
          skippedGooglePlaces++;
        }

        // Skip items without location data
        if (!item.location_name && !item.title) {
          result.no_location++;
          if (!dryRun) {
            await supabase.rpc("mark_image_search_attempted", {
              p_item_id: item.id,
            });
          }
          continue;
        }

        // Build search query from location name + town
        const searchQuery = [item.location_name || item.title, item.town]
          .filter(Boolean)
          .join(", ");

        console.log(`Searching venue for: "${item.title}" → query: "${searchQuery}"`);

        if (dryRun) {
          console.log(`  [DRY RUN] Would search: "${searchQuery}"`);
          continue;
        }

        // Google Places Text Search (New API)
        const searchBody: Record<string, any> = {
          textQuery: searchQuery,
          maxResultCount: 3,
        };

        // Add location bias if we have coordinates
        if (item.lat && item.lng) {
          searchBody.locationBias = {
            circle: {
              center: { latitude: item.lat, longitude: item.lng },
              radius: 5000.0,
            },
          };
        }

        const searchResponse = await fetch(
          `${PLACES_API_BASE}places:searchText`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.photos,places.primaryType",
            },
            body: JSON.stringify(searchBody),
          },
        );

        apiCallCount++;

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          console.error(`Text Search failed for "${item.title}":`, errorText);
          result.errors.push(`${item.title}: Text Search failed`);
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        const searchData = await searchResponse.json();
        const places = searchData.places || [];

        if (places.length === 0) {
          console.log(`  No places found for "${item.title}"`);
          result.no_match++;
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        // Find best matching place
        let bestPlace = null;
        let bestConfidence = 0;
        const matchName = item.location_name || item.title;

        for (const place of places) {
          const placeName = place.displayName?.text || "";

          // Skip parking lots and similar
          if (
            place.primaryType === "parking" ||
            place.primaryType === "gas_station"
          ) {
            continue;
          }

          const confidence = nameMatchConfidence(matchName, placeName);
          console.log(
            `  Match: "${placeName}" → confidence: ${confidence.toFixed(2)}`,
          );

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestPlace = place;
          }
        }

        if (!bestPlace || bestConfidence < CONFIDENCE_THRESHOLD) {
          console.log(
            `  No confident match for "${item.title}" (best: ${bestConfidence.toFixed(2)})`,
          );
          result.no_match++;
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        // Check if place has photos
        const photos = bestPlace.photos || [];
        if (photos.length === 0) {
          console.log(`  Place matched but no photos: "${bestPlace.displayName?.text}"`);
          result.no_match++;
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        result.matched++;
        console.log(
          `  Matched: "${bestPlace.displayName?.text}" (confidence: ${bestConfidence.toFixed(2)}, photos: ${photos.length})`,
        );

        // Fetch full-size photo
        const photoRef = photos[0];
        const fullImageUrl = `${PLACES_API_BASE}${photoRef.name}/media?maxHeightPx=${FULL_SIZE.maxHeight}&maxWidthPx=${FULL_SIZE.maxWidth}&key=${apiKey}`;
        const fullImageResponse = await fetch(fullImageUrl);
        apiCallCount++;

        if (!fullImageResponse.ok) {
          console.error(`Failed to fetch photo for "${item.title}"`);
          result.errors.push(`${item.title}: Photo fetch failed`);
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        const imageBlob = await fullImageResponse.blob();

        // Upload full-size to storage
        const fullPath = `items/${item.id}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(fullPath, imageBlob, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (uploadError) {
          console.error(`Upload failed for "${item.title}":`, uploadError);
          result.errors.push(`${item.title}: Upload failed`);
          await supabase.rpc("mark_image_search_attempted", {
            p_item_id: item.id,
          });
          continue;
        }

        // Get public URL
        const { data: publicUrlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(fullPath);

        // Fetch and upload thumbnail
        const thumbImageUrl = `${PLACES_API_BASE}${photoRef.name}/media?maxHeightPx=${THUMB_SIZE.maxHeight}&maxWidthPx=${THUMB_SIZE.maxWidth}&key=${apiKey}`;
        const thumbImageResponse = await fetch(thumbImageUrl);
        apiCallCount++;

        let thumbUrl = publicUrlData.publicUrl;

        if (thumbImageResponse.ok) {
          const thumbBlob = await thumbImageResponse.blob();
          const thumbPath = `items/${item.id}_thumb.jpg`;

          const { error: thumbUploadError } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(thumbPath, thumbBlob, {
              contentType: "image/jpeg",
              upsert: true,
            });

          if (!thumbUploadError) {
            const { data: thumbPublicUrlData } = supabase.storage
              .from(BUCKET_NAME)
              .getPublicUrl(thumbPath);
            thumbUrl = thumbPublicUrlData.publicUrl;
          }
        }

        // Update the explore item
        await supabase.rpc("update_source_image", {
          p_item_id: item.id,
          p_image_url: publicUrlData.publicUrl,
          p_thumb_url: thumbUrl,
          p_source: "google_places_lookup",
        });

        // Track API usage
        await supabase.rpc("increment_api_usage", {
          p_service: "google_places",
          p_count: thumbImageResponse.ok ? 3 : 2, // Text Search + Photo(s)
        });

        result.cached++;
        console.log(`  Cached image for: "${item.title}"`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing "${item.title}":`, errorMsg);
        result.errors.push(`${item.title}: ${errorMsg}`);
      }
    }

    // Get final coverage stats
    const { data: stats } = await supabase.rpc("get_image_coverage_stats");

    return new Response(
      JSON.stringify({
        ...result,
        skipped_google_places: skippedGooglePlaces,
        api_calls: apiCallCount,
        dry_run: dryRun,
        source_type_filter: sourceType,
        message: `Processed ${result.processed} items: ${result.cached} cached, ${result.no_match} no match, ${result.no_location} no location, ${skippedGooglePlaces} skipped (Google Places)`,
        stats: stats?.[0] || null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("lookup-venue-images error:", error);
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
