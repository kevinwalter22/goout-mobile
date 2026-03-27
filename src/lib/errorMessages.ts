/**
 * Maps raw Supabase / network errors to user-friendly messages.
 *
 * Usage:
 *   import { friendlyMessage } from "../lib/errorMessages";
 *   Alert.alert("Error", friendlyMessage(error));
 */

const SUPABASE_MAP: Record<string, string> = {
  // Auth
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Please verify your email before signing in.",
  "User already registered": "An account with this email already exists.",
  "Password should be at least 6 characters":
    "Password must be at least 6 characters.",
  "Email rate limit exceeded": "Too many signups right now. Please try again in a few minutes.",
  "email rate limit exceeded": "Too many signups right now. Please try again in a few minutes.",
  "For security purposes, you can only request this once every 60 seconds":
    "Please wait 60 seconds before trying again.",
  // Redirect URL not in Supabase allowlist — Supabase project config issue
  "Redirect URL not allowed": "Unable to create account. Please try again or contact support.",
  // DB trigger failure creating the profile row
  "Database error saving new user": "Unable to create your account. Please try again.",
  // Signup disabled or CAPTCHA required in Supabase dashboard
  "Signups not allowed for this instance": "Sign-ups are currently disabled.",

  // RLS / ownership
  "Forbidden: caller does not own this resource":
    "You don't have permission to do that.",
  "new row violates row-level security policy":
    "You don't have permission to do that.",

  // Rate limiting
  "Rate limit exceeded": "You're doing that too fast. Please wait a moment.",

  // Storage
  "The resource already exists": "This file already exists.",
  "Bucket not found": "Upload failed. Please try again.",
  "The object was not found": "The file could not be found.",

  // Database
  "duplicate key value violates unique constraint":
    "This already exists.",
  "JWT expired": "Your session has expired. Please sign in again.",
};

/** Patterns matched via startsWith / includes */
const PATTERN_MAP: Array<[test: (msg: string) => boolean, friendly: string]> = [
  [
    (m) => m.includes("Failed to fetch") || m.includes("NetworkError"),
    "Network error. Check your connection and try again.",
  ],
  [
    (m) => m.includes("timeout") || m.includes("TIMEOUT"),
    "Request timed out. Please try again.",
  ],
  [
    (m) => m.includes("JWT"),
    "Your session has expired. Please sign in again.",
  ],
];

const FALLBACK = "Something went wrong. Please try again.";

/**
 * Convert an unknown error into a user-safe string.
 * Never returns raw stack traces or internal details.
 */
export function friendlyMessage(error: unknown): string {
  const raw = extractMessage(error);
  if (!raw) return FALLBACK;

  // Exact match first
  if (SUPABASE_MAP[raw]) return SUPABASE_MAP[raw];

  // Partial / pattern match
  for (const [test, friendly] of PATTERN_MAP) {
    if (test(raw)) return friendly;
  }

  // Check if any key is a substring of the raw message (case-insensitive)
  const rawLower = raw.toLowerCase();
  for (const [key, friendly] of Object.entries(SUPABASE_MAP)) {
    if (rawLower.includes(key.toLowerCase())) return friendly;
  }

  return FALLBACK;
}

function extractMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.error_description === "string") return e.error_description;
  }
  return String(error);
}
