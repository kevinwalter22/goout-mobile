/**
 * Shared auth guards for Edge Functions.
 *
 * requireUser()        — for user-facing functions (validates JWT)
 * requireServiceRole() — for internal/ops functions (validates service-role key)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Validate the caller's JWT and return the authenticated user.
 * Use for user-facing functions (delete-account, fetch-place-details, etc.)
 */
export async function requireUser(
  req: Request
): Promise<{ user: any; error: null } | { user: null; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { user: null, error: "Missing authorization" };

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return { user: null, error: "Unauthorized" };
  return { user, error: null };
}

/**
 * Validate that the caller is using the service-role key.
 * Use for internal/ops functions called by fetch-coordinator, cron, or admin scripts.
 *
 * When fetch-coordinator invokes sub-functions via supabase.functions.invoke(),
 * the JS client automatically passes Authorization: Bearer <service-role-key>.
 */
export function requireServiceRole(
  req: Request
): { ok: boolean; error?: string } {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "Missing authorization" };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = authHeader.replace("Bearer ", "");
  if (token !== serviceKey) return { ok: false, error: "Forbidden" };
  return { ok: true };
}
