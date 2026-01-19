import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

export function useEventRSVP(eventId: string) {
  const { user } = useAuth();
  const [isGoing, setIsGoing] = useState(false);
  const [goingCount, setGoingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function loadRSVPStatus() {
    if (!user) {
      setIsGoing(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Check if current user has RSVPed
    const { data: myRSVP } = await supabase
      .from("event_rsvps")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    setIsGoing(!!myRSVP);

    // Get total count of RSVPs
    const { count } = await supabase
      .from("event_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);

    setGoingCount(count ?? 0);
    setLoading(false);
  }

  async function toggleRSVP() {
    if (!user) return;

    if (isGoing) {
      // Remove RSVP
      const { error } = await supabase
        .from("event_rsvps")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", user.id);

      if (!error) {
        setIsGoing(false);
        setGoingCount((prev) => Math.max(0, prev - 1));
      }
    } else {
      // Add RSVP
      const { error } = await supabase
        .from("event_rsvps")
        .insert({ event_id: eventId, user_id: user.id });

      if (!error) {
        setIsGoing(true);
        setGoingCount((prev) => prev + 1);
      }
    }
  }

  useEffect(() => {
    loadRSVPStatus();
  }, [eventId, user?.id]);

  return {
    isGoing,
    goingCount,
    loading,
    toggleRSVP,
    refresh: loadRSVPStatus,
  };
}
