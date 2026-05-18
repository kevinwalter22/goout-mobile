/**
 * Shared auth guards for Edge Functions.
 *
 * requireUser()        — for user-facing functions (validates JWT)
 * requireServiceRole() — for internal/ops functions (validates service-role key)
 */

/**
 * Validate the caller's JWT and return the authenticated user.
 * Use for user-facing functions (delete-account, fetch-place-details, etc.)
 */
export async function requireUser(
  req: Request
): Promise<{ user: any; error: null } | { user: null; error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { user: null, error: "Missing authorization" };
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const jwt = authHeader.replace(/^Bearer\s+/i, "");

  let resp: Response;
  try {
    resp = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        apikey: anonKey,
      },
    });
  } catch (err) {
    console.error("[auth-guard] Fetch threw:", err);
    return { user: null, error: "Unauthorized" };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(unreadable)");
    console.error("[auth-guard] Auth rejected:", resp.status, body);
    return { user: null, error: "Unauthorized" };
  }

  let user: any;
  try {
    user = await resp.json();
  } catch (err) {
    console.error("[auth-guard] Failed to parse user JSON:", err);
    return { user: null, error: "Unauthorized" };
  }

  if (!user?.id) {
    console.error("[auth-guard] No user.id in response:", JSON.stringify(user));
    return { user: null, error: "Unauthorized" };
  }

  return { user, error: null };
}

/**
 * Validate that the caller is using a service-role key.
 * Use for internal/ops functions called by fetch-coordinator, cron, or admin scripts.
 *
 * Compares against multiple valid forms to survive Supabase's migration from
 * legacy service-role JWTs to the new sb_secret_* format:
 *   - SUPABASE_SERVICE_ROLE_KEY   — auto-injected; on current Supabase platform this is the sb_secret_* form
 *   - SUPABASE_SECRET_KEYS        — auto-injected; comma-separated list of valid secret keys
 *   - LEGACY_SERVICE_ROLE_JWT     — custom secret holding the legacy JWT-form service-role key.
 *                                   pg_cron jobs created via migration 088 still call with the
 *                                   legacy JWT (the DB-level app.service_role_key setting can't
 *                                   be updated from the dashboard SQL editor without superuser).
 *                                   Accepting it here lets cron keep working without DB changes.
 *
 * Direct string comparison only — never trust a JWT payload's `role` claim
 * without verifying the signature.
 */
export function requireServiceRole(
  req: Request
): { ok: boolean; error?: string } {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, error: "Missing authorization" };

  const token = authHeader.replace("Bearer ", "");

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return { ok: true };

  const legacyJwt = Deno.env.get("LEGACY_SERVICE_ROLE_JWT");
  if (legacyJwt && token === legacyJwt) return { ok: true };

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const valid = secretKeys.split(",").map((k) => k.trim()).filter(Boolean);
    if (valid.includes(token)) return { ok: true };
  }

  return { ok: false, error: "Forbidden" };
}
