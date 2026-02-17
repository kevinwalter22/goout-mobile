/**
 * Cache Place Photos — Background Image Caching Edge Function
 *
 * Fetches photos from Google Places API for explore items and caches them
 * in Supabase Storage for fast, cost-effective delivery via CDN.
 *
 * Request: POST { max_items?: number, mode?: "cache" | "refresh" | "stats" }
 *   - mode: "cache" (default) - cache new images
 *   - mode: "refresh" - refresh stale images (>30 days old)
 *   - mode: "stats" - return coverage statistics only
 *
 * Response: { processed: number, cached: number, errors: string[], stats?: {...} }
 *
 * Budget: Each photo fetch costs ~$0.007 (Places Photo request).
 * Cache TTL: 30 days (items get re-fetched after that).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { requireServiceRole } from "../_shared/auth-guard.ts";

// Google Places API (New) endpoints
const PLACES_API_BASE = "https://places.googleapis.com/v1/";

// Image sizes
const FULL_SIZE = { maxWidth: 1200, maxHeight: 800 };
const THUMB_SIZE = { maxWidth: 400, maxHeight: 300 };

// Storage bucket name
const BUCKET_NAME = "explore-images";

interface ItemNeedingImage {
  id: string;
  external_id: string;
  title: string;
  source_type: string;
}

interface PhotoMetadata {
  name: string;
  width: number;
  height: number;
}

interface ProcessResult {
  processed: number;
  cached: number;
  skipped: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  const corsHeaders = getCorsHeaders(req);

  const auth = requireServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const maxItems = Math.min(body.max_items || 25, 100);
    const mode = body.mode || "cache"; // "cache", "refresh", or "stats"

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Helper to get coverage stats
    async function getCoverageStats() {
      const { data, error } = await supabase.rpc("get_image_coverage_stats");
      if (error) {
        console.error("Error fetching stats:", error);
        return null;
      }
      return data?.[0] || null;
    }

    // Mode: stats only - return coverage statistics
    if (mode === "stats") {
      const stats = await getCoverageStats();
      return new Response(
        JSON.stringify({
          mode: "stats",
          stats,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_PLACES_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Mode: refresh - get stale images instead of new ones
    let items: ItemNeedingImage[] | null = null;
    let itemsError: any = null;

    if (mode === "refresh") {
      const result = await supabase.rpc("get_stale_images", { p_limit: maxItems });
      items = result.data;
      itemsError = result.error;
    } else {
      // Mode: cache (default) - get items needing images
      const result = await supabase.rpc("get_items_needing_images", { p_limit: maxItems });
      items = result.data;
      itemsError = result.error;
    }

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
      const stats = await getCoverageStats();
      return new Response(
        JSON.stringify({
          mode,
          processed: 0,
          cached: 0,
          skipped: 0,
          errors: [],
          message: mode === "refresh"
            ? "No stale images need refreshing"
            : "No items need image caching",
          stats,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const result: ProcessResult = {
      processed: 0,
      cached: 0,
      skipped: 0,
      errors: [],
    };

    // Process each item
    for (const item of items as ItemNeedingImage[]) {
      result.processed++;

      try {
        // Check if we already have photo metadata in cache
        const { data: cachedDetails } = await supabase
          .from("place_details_cache")
          .select("photos")
          .eq("explore_item_id", item.id)
          .single();

        let photos: PhotoMetadata[] = cachedDetails?.photos || [];

        // If no cached photos, fetch from Google Places API
        if (photos.length === 0) {
          const placeResourceName = item.external_id.startsWith("places/")
            ? item.external_id
            : `places/${item.external_id}`;

          const detailsResponse = await fetch(
            `${PLACES_API_BASE}${placeResourceName}`,
            {
              headers: {
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": "photos",
              },
            },
          );

          if (!detailsResponse.ok) {
            const errorText = await detailsResponse.text();
            console.error(`Failed to fetch place details for ${item.title}:`, errorText);
            result.errors.push(`${item.title}: Failed to fetch place details`);
            continue;
          }

          const detailsData = await detailsResponse.json();
          photos = (detailsData.photos || []).slice(0, 3).map((p: any) => ({
            name: p.name,
            width: p.widthPx || 0,
            height: p.heightPx || 0,
          }));

          if (photos.length === 0) {
            result.skipped++;
            // Mark as processed (no image available) to avoid retrying
            await supabase.rpc("update_item_image", {
              p_item_id: item.id,
              p_image_url: null,
              p_thumb_url: null,
            });
            continue;
          }
        }

        // Use the first photo
        const photoRef = photos[0];

        // Fetch full-size image
        const fullImageUrl = `${PLACES_API_BASE}${photoRef.name}/media?maxHeightPx=${FULL_SIZE.maxHeight}&maxWidthPx=${FULL_SIZE.maxWidth}&key=${apiKey}`;
        const fullImageResponse = await fetch(fullImageUrl);

        if (!fullImageResponse.ok) {
          console.error(`Failed to fetch photo for ${item.title}`);
          result.errors.push(`${item.title}: Failed to fetch photo`);
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
          console.error(`Failed to upload image for ${item.title}:`, uploadError);
          result.errors.push(`${item.title}: Upload failed`);
          continue;
        }

        // Get public URL
        const { data: publicUrlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(fullPath);

        // Fetch thumbnail (smaller version)
        const thumbImageUrl = `${PLACES_API_BASE}${photoRef.name}/media?maxHeightPx=${THUMB_SIZE.maxHeight}&maxWidthPx=${THUMB_SIZE.maxWidth}&key=${apiKey}`;
        const thumbImageResponse = await fetch(thumbImageUrl);

        let thumbUrl = publicUrlData.publicUrl; // Default to full if thumb fails

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

        // Update the explore item with cached URLs
        const { error: updateError } = await supabase.rpc("update_item_image", {
          p_item_id: item.id,
          p_image_url: publicUrlData.publicUrl,
          p_thumb_url: thumbUrl,
        });

        if (updateError) {
          console.error(`Failed to update item ${item.title}:`, updateError);
          result.errors.push(`${item.title}: Database update failed`);
          continue;
        }

        // Track API usage
        await supabase.rpc("increment_api_usage", {
          p_service: "google_places",
          p_count: thumbImageResponse.ok ? 2 : 1, // Count both photo requests
        });

        result.cached++;
        console.log(`Cached image for: ${item.title}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing ${item.title}:`, errorMsg);
        result.errors.push(`${item.title}: ${errorMsg}`);
      }
    }

    // Get final coverage stats
    const stats = await getCoverageStats();

    return new Response(
      JSON.stringify({
        mode,
        ...result,
        message: `Processed ${result.processed} items, cached ${result.cached} images`,
        stats,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("cache-place-photos error:", error);
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
