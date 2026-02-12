import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type UpcomingPlan = {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location_name: string | null;
  town: string | null;
  kind: "event" | "activity";
  image_thumb_url: string | null;
};

export function useUpcomingPlans(userId: string | null | undefined) {
  const [plans, setPlans] = useState<UpcomingPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setPlans([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);

      const { data, error } = await supabase
        .from("explore_item_rsvps")
        .select(
          "explore_item_id, explore_items(id, title, starts_at, ends_at, location_name, town, kind, image_thumb_url)"
        )
        .eq("user_id", userId!);

      if (error || !data) {
        setPlans([]);
        setLoading(false);
        return;
      }

      const now = Date.now();
      const upcoming: UpcomingPlan[] = [];

      for (const row of data) {
        const item = (row as any).explore_items;
        if (!item) continue;

        // For events with dates: only include future or currently happening
        if (item.starts_at) {
          const endTime = item.ends_at
            ? new Date(item.ends_at).getTime()
            : new Date(item.starts_at).getTime() + 3 * 60 * 60 * 1000;
          if (endTime < now) continue; // already ended
        }

        upcoming.push({
          id: item.id,
          title: item.title,
          starts_at: item.starts_at,
          ends_at: item.ends_at,
          location_name: item.location_name,
          town: item.town,
          kind: item.kind,
          image_thumb_url: item.image_thumb_url,
        });
      }

      // Sort: events with dates first (soonest first), then activities
      upcoming.sort((a, b) => {
        if (a.starts_at && b.starts_at) {
          return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        }
        if (a.starts_at) return -1;
        if (b.starts_at) return 1;
        return a.title.localeCompare(b.title);
      });

      setPlans(upcoming.slice(0, 5));
      setLoading(false);
    }

    load();
  }, [userId]);

  return { plans, loading };
}
