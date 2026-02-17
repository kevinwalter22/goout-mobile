import { supabase } from "./supabase";
import type { Profile, PublicProfile } from "../types/database";

/**
 * Fetch safe public fields for any user (id, username, avatar_url, bio, created_at).
 * Always succeeds for any authenticated caller.
 */
export async function getDisplayProfile(
  userId: string
): Promise<PublicProfile | null> {
  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, username, avatar_url, bio, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[profileQueries] getDisplayProfile error:", error);
    return null;
  }
  return data as PublicProfile | null;
}

/**
 * Fetch full profile (all columns). Only succeeds for self or accepted friends.
 * Returns null if RLS blocks access (non-friend).
 */
export async function getFullProfile(
  userId: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // PGRST116 = 0 rows (RLS blocked) — not a real error
    if (error.code !== "PGRST116") {
      console.error("[profileQueries] getFullProfile error:", error);
    }
    return null;
  }
  return data as Profile | null;
}
