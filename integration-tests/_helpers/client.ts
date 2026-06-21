/**
 * Supabase clients for integration tests, pinned to staging.
 *
 * - adminClient(): service-role, bypasses RLS. Use for seeding, cleanup, and
 *   asserting server state. NEVER ship this key to a client build.
 * - anonClient(): anon key, subject to RLS. Use to exercise the same surface a
 *   real app session hits (then attach a user session via signInWithPassword).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assertStagingEnv } from "./env";

let _admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  const { url, serviceRoleKey } = assertStagingEnv();
  _admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/** A fresh anon client (not memoised — callers may attach distinct sessions). */
export function anonClient(): SupabaseClient {
  const { url, anonKey } = assertStagingEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function stagingUrl(): string {
  return assertStagingEnv().url;
}
