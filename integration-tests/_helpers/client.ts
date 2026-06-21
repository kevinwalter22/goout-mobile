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

/**
 * An anon client signed in as the given user — exercises the same RLS-gated
 * surface a real app session hits. Returns the client and the session's access
 * token (useful for calling edge functions with the user's JWT).
 */
export async function authedClient(
  email: string,
  password: string,
): Promise<{ client: SupabaseClient; accessToken: string }> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`authedClient sign-in failed: ${error?.message ?? "no session"}`);
  }
  return { client, accessToken: data.session.access_token };
}
