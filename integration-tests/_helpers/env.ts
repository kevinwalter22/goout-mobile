/**
 * Integration-test environment loader + safety guard.
 *
 * Integration tests SEED AND DELETE real rows. They must only ever run against
 * the staging Supabase project — never production. This module loads the staging
 * credentials and hard-refuses to proceed if the configured URL looks like prod.
 *
 * Credentials are read from .env.staging (preferred) with a fallback to the
 * staging-prefixed keys in .env.local, so a developer with either file works.
 * Nothing is hard-coded; if the env is missing the tests fail loudly.
 */
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env.staging first, then .env.local as a fallback (dotenv does not
// overwrite already-set keys, so .env.staging wins where both define a key).
const root = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(root, ".env.staging") });
dotenv.config({ path: path.join(root, ".env.local") });

function pick(...names: string[]): string | undefined {
  for (const n of names) {
    // Node-only test helper (not bundled into the app) — dynamic env lookup is
    // intentional so we can fall back across alternate secret names.
    // eslint-disable-next-line expo/no-dynamic-env-var
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

export const STAGING_URL = pick(
  "STAGING_SUPABASE_URL",
  "SUPABASE_STAGING_URL",
);

export const STAGING_SERVICE_ROLE_KEY = pick(
  "STAGING_SERVICE_ROLE_KEY",
  "SUPABASE_STAGING_SERVICE_ROLE_KEY",
);

export const STAGING_ANON_KEY = pick(
  "STAGING_SUPABASE_ANON_KEY",
  "SUPABASE_STAGING_ANON_KEY",
  // .env.staging stores the anon key under the EXPO_PUBLIC_ name.
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
);

/** DSN of the euda-edge Sentry project (the edge crash-reporting target). */
export const SENTRY_DSN_EDGE = pick("SENTRY_DSN_EDGE");

/**
 * Production project ref. If the configured staging URL ever points here we
 * abort immediately — integration tests create and delete data and must never
 * touch prod. (Migration 137 / sacred data lives in prod.)
 */
const PROD_PROJECT_REF = "lkmntknpaiaiqvupzjbz";

/** Known-staging project ref, for a positive confirmation. */
const STAGING_PROJECT_REF = "baulipaydofqtkihkghj";

/**
 * Throws unless we are pointed at a non-prod Supabase project with all three
 * credentials present. Call this once before any seeding happens.
 */
export function assertStagingEnv(): {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
} {
  if (!STAGING_URL || !STAGING_SERVICE_ROLE_KEY || !STAGING_ANON_KEY) {
    throw new Error(
      "Integration tests require staging credentials. Set STAGING_SUPABASE_URL, " +
        "STAGING_SERVICE_ROLE_KEY and STAGING_SUPABASE_ANON_KEY in .env.staging " +
        "(or the SUPABASE_STAGING_* equivalents in .env.local).",
    );
  }

  if (STAGING_URL.includes(PROD_PROJECT_REF)) {
    throw new Error(
      `REFUSING TO RUN: integration-test URL points at the PRODUCTION project ` +
        `(${PROD_PROJECT_REF}). Integration tests seed and delete data and must ` +
        `only run against staging.`,
    );
  }

  if (!STAGING_URL.includes(STAGING_PROJECT_REF)) {
    // Not prod, but also not the ref we expect. Allow (a new staging project is
    // legitimate) but make the deviation visible in the test log.
    // eslint-disable-next-line no-console
    console.warn(
      `[integration] staging URL does not match the expected ref ` +
        `${STAGING_PROJECT_REF}; proceeding because it is not prod. URL host: ` +
        `${new URL(STAGING_URL).host}`,
    );
  }

  return {
    url: STAGING_URL,
    serviceRoleKey: STAGING_SERVICE_ROLE_KEY,
    anonKey: STAGING_ANON_KEY,
  };
}
