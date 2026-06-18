/**
 * Centralized environment configuration.
 * Single source of truth for all client-side env vars.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const PHONE_HASH_SALT = process.env.EXPO_PUBLIC_PHONE_HASH_SALT ?? "";
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";
const APP_ENV_OVERRIDE = process.env.EXPO_PUBLIC_APP_ENV ?? "";

export type AppEnv = "dev" | "staging" | "prod";

/**
 * Resolve which environment this build points at.
 *
 * Primary signal: the explicit `EXPO_PUBLIC_APP_ENV` build var. This is the
 * only reliable signal because Supabase project refs are random strings
 * (e.g. prod is `lkmntknpaiaiqvupzjbz`) — a staging project's URL does NOT
 * contain the word "staging", so URL string-matching cannot distinguish
 * staging from prod. Each EAS build profile sets EXPO_PUBLIC_APP_ENV.
 *
 * Fallback (when the var is unset, e.g. an old local .env): treat a
 * localhost URL as dev and everything else as prod. This intentionally
 * never guesses "staging" — better to fail safe by assuming prod (banner
 * shows nothing, Sentry tags prod) than to mislabel a prod build as staging.
 */
function detectEnv(override: string, url: string): AppEnv {
  if (override === "dev" || override === "staging" || override === "prod") {
    return override;
  }
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) return "dev";
  return "prod";
}

export const Env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PHONE_HASH_SALT,
  SENTRY_DSN,
  APP_ENV: detectEnv(APP_ENV_OVERRIDE, SUPABASE_URL) as AppEnv,
  IS_DEV: __DEV__,
} as const;

/** Returns list of missing required env vars. Empty array = all valid. */
export function validateEnv(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (!PHONE_HASH_SALT) missing.push("EXPO_PUBLIC_PHONE_HASH_SALT");
  return missing;
}
