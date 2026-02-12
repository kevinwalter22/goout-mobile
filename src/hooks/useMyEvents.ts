import { useState, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import type { ExploreItem } from "../types/database";

export interface UpdateEventInput {
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  location_name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export function useMyEvents() {
  const { user } = useAuth();
  const [events, setEvents] = useState<ExploreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMyEvents = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from("explore_items")
        .select("*")
        .eq("created_by_user_id", user.id)
        .is("deleted_at", null)
        .order("starts_at", { ascending: true });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setEvents((data as ExploreItem[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch events";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const updateEvent = useCallback(
    async (eventId: string, input: UpdateEventInput): Promise<boolean> => {
      if (!user) {
        setError("You must be logged in to update an event");
        return false;
      }

      try {
        const updateData: Record<string, unknown> = {};
        if (input.title !== undefined) updateData.title = input.title;
        if (input.description !== undefined) updateData.description = input.description;
        if (input.starts_at !== undefined) updateData.starts_at = input.starts_at;
        if (input.ends_at !== undefined) updateData.ends_at = input.ends_at;
        if (input.location_name !== undefined) updateData.location_name = input.location_name;
        if (input.address !== undefined) updateData.address = input.address;
        if (input.lat !== undefined) updateData.lat = input.lat;
        if (input.lng !== undefined) updateData.lng = input.lng;

        const { error: updateError } = await supabase
          .from("explore_items")
          .update(updateData)
          .eq("id", eventId)
          .eq("created_by_user_id", user.id); // RLS enforced, but double-check

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Update local state
        setEvents((prev) =>
          prev.map((e) => (e.id === eventId ? { ...e, ...updateData } : e))
        );

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update event";
        setError(message);
        return false;
      }
    },
    [user]
  );

  const deleteEvent = useCallback(
    async (eventId: string): Promise<boolean> => {
      if (!user) {
        setError("You must be logged in to delete an event");
        return false;
      }

      try {
        // Soft delete — hides from all queries, can be restored by admin
        const { error: deleteError } = await supabase
          .from("explore_items")
          .update({ deleted_at: new Date().toISOString() } as any)
          .eq("id", eventId)
          .eq("created_by_user_id", user.id); // RLS enforced, but double-check

        if (deleteError) {
          throw new Error(deleteError.message);
        }

        // Update local state
        setEvents((prev) => prev.filter((e) => e.id !== eventId));

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete event";
        setError(message);
        return false;
      }
    },
    [user]
  );

  useEffect(() => {
    fetchMyEvents();
  }, [fetchMyEvents]);

  return {
    events,
    loading,
    error,
    refresh: fetchMyEvents,
    updateEvent,
    deleteEvent,
    clearError: () => setError(null),
  };
}
