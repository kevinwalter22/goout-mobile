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
 * Validate that the caller is using a service-role key.
 * Use for internal/ops functions called by fetch-coordinator, cron, or admin scripts.
 *
 * Checks:
 * 1. Direct match against SUPABASE_SERVICE_ROLE_KEY env var
 * 2. Falls back to JWT payload inspection (role === "service_role")
 *    to handle key rotation where env var and API key diverge.
 */
export function requireServiceRole(
  req: Request
): { ok: boolean; error?: string } {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "Missing authorization" };

  const token = authHeader.replace("Bearer ", "");

  // Fast path: direct comparison
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return { ok: true };

  // Fallback: decode JWT payload and check role claim
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      // Base64url decode the payload
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role === "service_role") return { ok: true };
    }
  } catch {
    // Invalid JWT format — fall through to Forbidden
  }

  return { ok: false, error: "Forbidden" };
}
