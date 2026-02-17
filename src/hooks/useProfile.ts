import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Profile, PublicProfile } from "../types/database";

export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<Profile | PublicProfile | null>(null);
  const [isFullProfile, setIsFullProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userId) {
      loadProfile();
    }
  }, [userId]);

  async function loadProfile() {
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      // Try full profile first (succeeds for self + accepted friends)
      const { data: fullData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (fullData) {
        setProfile(fullData);
        setIsFullProfile(true);
        return;
      }

      // Fall back to public_profiles (safe columns for any user)
      const { data: publicData, error: publicError } = await supabase
        .from("public_profiles")
        .select("id, username, avatar_url, bio, created_at")
        .eq("id", userId)
        .maybeSingle();

      if (publicError) throw publicError;

      setProfile(publicData);
      setIsFullProfile(false);
    } catch (err) {
      console.error("Error loading profile:", err);
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  return {
    profile,
    isFullProfile,
    loading,
    error,
    refresh: loadProfile,
  };
}
