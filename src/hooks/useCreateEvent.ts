import { useState, useCallback } from "react";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { checkBeforeSubmit, moderateText } from "../lib/moderation/textModeration";
import { uploadEventImage } from "../utils/storage";
import { requestImageModeration } from "../utils/imageModeration";
import type { ExploreItem } from "../types/database";

/**
 * Geocode an address to get lat/lng coordinates
 * Uses Expo Location which leverages native geocoding (Apple Maps / Google)
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const results = await Location.geocodeAsync(address);
    if (results.length > 0) {
      return {
        lat: results[0].latitude,
        lng: results[0].longitude,
      };
    }
    return null;
  } catch (error) {
    console.log("[geocodeAddress] Failed to geocode:", error);
    return null;
  }
}

export interface CreateEventInput {
  title: string;
  description?: string;
  starts_at: string; // ISO 8601
  ends_at?: string;
  location_name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  visibility?: "friends_only" | "public";
  recurrence?: "weekly" | "monthly";
  imageUri?: string;
}

export function useCreateEvent() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createEvent = useCallback(
    async (input: CreateEventInput): Promise<ExploreItem | null> => {
      if (!user) {
        setError("You must be logged in to create an event");
        return null;
      }

      setLoading(true);
      setError(null);

      // Enforcement check
      const { data: enforcement } = await supabase.rpc("check_enforcement");
      if (enforcement && enforcement.length > 0) {
        const e = enforcement[0];
        if (e.is_suspended && (!e.suspended_until || new Date(e.suspended_until) > new Date())) {
          const untilStr = e.suspended_until
            ? ` until ${new Date(e.suspended_until).toLocaleDateString()}`
            : "";
          setError(`Your account is suspended${untilStr}. You cannot create events.`);
          setLoading(false);
          return null;
        }
      }

      // Pre-submit moderation on title + description
      const titleCheck = checkBeforeSubmit(input.title, "event");
      if (!titleCheck.allowed) {
        setError(titleCheck.reason);
        setLoading(false);
        return null;
      }
      if (input.description) {
        const descCheck = checkBeforeSubmit(input.description, "event");
        if (!descCheck.allowed) {
          setError(descCheck.reason);
          setLoading(false);
          return null;
        }
      }

      try {
        // Determine review_status based on visibility + text moderation
        const visibility = input.visibility ?? "friends_only";
        let reviewStatus: string = "auto_approved";

        // Run moderateText to detect quarantine-level content
        const combinedText = [input.title, input.description].filter(Boolean).join(" ");
        const modResult = moderateText(combinedText, "event");

        if (modResult.action === "quarantine" || visibility === "public") {
          // Public events always need approval; quarantine-level text also needs review
          reviewStatus = "quarantined";
        }

        // Shadowbanned users' events always quarantined
        if (enforcement?.[0]?.is_shadowbanned) {
          reviewStatus = "quarantined";
        }

        // Try to get the "User Created" source_id (optional - may not exist yet)
        let sourceId: number | null = null;
        const { data: sourceData } = await supabase
          .from("event_sources")
          .select("id")
          .eq("name", "User Created")
          .maybeSingle();

        if (sourceData) {
          sourceId = sourceData.id as any;
        }
        // If source doesn't exist, proceed without it (source_id can be null)

        // Geocode address if lat/lng not provided but address exists
        let lat = input.lat ?? null;
        let lng = input.lng ?? null;

        if ((lat === null || lng === null) && input.address) {
          const coords = await geocodeAddress(input.address);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
          }
        }

        // Insert the new event
        const { data: newEvent, error: insertError } = await supabase
          .from("explore_items")
          .insert({
            title: input.title,
            description: input.description || null,
            starts_at: input.starts_at,
            ends_at: input.ends_at || null,
            location_name: input.location_name || null,
            address: input.address || null,
            lat,
            lng,
            kind: "event",
            source_id: sourceId,
            priority: 0,
            price_bucket: "unknown",
            effort: "unknown",
            is_anchor: false,
            is_hidden_gem: false,
            created_by_user_id: user.id,
            visibility,
            review_status: reviewStatus,
            recurrence: input.recurrence || null,
          } as any)
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        // Upload cover image if provided
        if (input.imageUri && newEvent) {
          const imageUrl = await uploadEventImage(input.imageUri, user.id, newEvent.id);
          if (imageUrl) {
            await supabase
              .from("explore_items")
              .update({ image_url: imageUrl })
              .eq("id", newEvent.id);
            (newEvent as any).image_url = imageUrl;
            // Fire-and-forget moderation (same pattern as post images)
            requestImageModeration({ bucket: "posts", path: `events/${user.id}/${newEvent.id}.jpg` });
          }
        }

        return newEvent as ExploreItem;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create event";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  return {
    createEvent,
    loading,
    error,
    clearError: () => setError(null),
  };
}
