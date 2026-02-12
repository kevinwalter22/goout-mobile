/**
 * Centralized environment configuration.
 * Single source of truth for all client-side env vars.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

export type AppEnv = "dev" | "staging" | "prod";

function detectEnv(url: string): AppEnv {
  if (!url || url.includes("localhost") || url.includes("127.0.0.1")) return "dev";
  if (url.includes("staging")) return "staging";
  return "prod";
}

export const Env = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SENTRY_DSN,
  APP_ENV: detectEnv(SUPABASE_URL) as AppEnv,
  IS_DEV: __DEV__,
} as const;

/** Returns list of missing required env vars. Empty array = all valid. */
export function validateEnv(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}
