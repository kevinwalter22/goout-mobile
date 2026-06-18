/**
 * Seed + cleanup helpers for integration tests.
 *
 * Every created resource is recorded in a per-namespace registry so that
 * cleanupNamespace() deletes exactly — and only — what a run created. Test
 * explore_items are additionally tagged via external_id = "<ns>:<uuid>" so a
 * marker-based sweep can catch anything inserted outside these helpers.
 *
 * All operations use the service-role (admin) client and therefore bypass RLS;
 * triggers (e.g. migration 137) still fire, which is the point.
 */
import { randomUUID } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { testUserEmail, TEST_MARKER } from "./namespace";

type Registry = { userIds: Set<string>; itemIds: Set<string> };
const registry = new Map<string, Registry>();

function reg(ns: string): Registry {
  let r = registry.get(ns);
  if (!r) {
    r = { userIds: new Set(), itemIds: new Set() };
    registry.set(ns, r);
  }
  return r;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Create an email-confirmed ephemeral auth user inside a namespace. */
export async function createTestUser(
  admin: SupabaseClient,
  ns: string,
  suffix = "",
): Promise<TestUser> {
  const email = testUserEmail(ns, suffix);
  const password = `Test-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }
  reg(ns).userIds.add(data.user.id);
  return { id: data.user.id, email, password };
}

export interface SeedItemOverrides {
  kind?: "event" | "activity";
  title?: string;
  category?: string;
  town?: string;
  lat?: number | null;
  lng?: number | null;
  review_status?: string;
  is_chain?: boolean;
  created_by_user_id?: string | null;
  starts_at?: string | null;
  [key: string]: unknown;
}

/** Insert a minimal valid explore_item, namespaced via external_id. */
export async function insertExploreItem(
  admin: SupabaseClient,
  ns: string,
  overrides: SeedItemOverrides = {},
): Promise<{ id: string; external_id: string }> {
  const id = randomUUID();
  const external_id = `${ns}:${id}`;
  const row = {
    id,
    external_id,
    source_id: null,
    kind: overrides.kind ?? "event",
    title: overrides.title ?? `${TEST_MARKER} ${ns} item`,
    category: overrides.category ?? "community",
    town: overrides.town ?? "Warwick",
    lat: overrides.lat === undefined ? 41.2557 : overrides.lat,
    lng: overrides.lng === undefined ? -74.3601 : overrides.lng,
    review_status: overrides.review_status ?? "auto_approved",
    relevance_tier: 2,
    price_bucket: "unknown",
    tags: [],
    ...overrides,
  };
  const { data, error } = await admin
    .from("explore_items")
    .insert(row as any)
    .select("id, external_id")
    .single();
  if (error || !data) {
    throw new Error(`insertExploreItem failed: ${error?.message ?? "no row"}`);
  }
  reg(ns).itemIds.add(data.id);
  return { id: data.id, external_id: data.external_id };
}

/** Record an externally-created id so cleanup will remove it. */
export function trackItem(ns: string, id: string): void {
  reg(ns).itemIds.add(id);
}
export function trackUser(ns: string, id: string): void {
  reg(ns).userIds.add(id);
}

/**
 * Delete everything a namespace created: dependent rows first (posts,
 * engagement_log, rsvps), then explore_items (registry + marker sweep), then the
 * auth users (cascades to their profiles). Best-effort and idempotent — safe to
 * call in afterAll even if setup half-failed.
 */
export async function cleanupNamespace(
  admin: SupabaseClient,
  ns: string,
): Promise<void> {
  const r = reg(ns);
  const userIds = [...r.userIds];
  const itemIds = [...r.itemIds];

  const swallow = async (p: PromiseLike<{ error: unknown }>) => {
    try {
      const { error } = await p;
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[cleanup ${ns}] ${(error as any)?.message ?? error}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[cleanup ${ns}] ${(e as Error).message}`);
    }
  };

  // Dependent rows by user and by item.
  if (userIds.length) {
    await swallow(admin.from("posts").delete().in("user_id", userIds) as any);
    await swallow(
      admin.from("engagement_log").delete().in("user_id", userIds) as any,
    );
    await swallow(
      admin.from("explore_item_rsvps").delete().in("user_id", userIds) as any,
    );
  }
  if (itemIds.length) {
    await swallow(
      admin.from("posts").delete().in("explore_item_id", itemIds) as any,
    );
    await swallow(
      admin.from("engagement_log").delete().in("explore_item_id", itemIds) as any,
    );
    await swallow(
      admin.from("explore_item_rsvps").delete().in("explore_item_id", itemIds) as any,
    );
  }

  // explore_items: registry ids + marker sweep (anything tagged with this ns).
  if (itemIds.length) {
    await swallow(admin.from("explore_items").delete().in("id", itemIds) as any);
  }
  await swallow(
    admin.from("explore_items").delete().like("external_id", `${ns}:%`) as any,
  );

  // Auth users last (cascades to profiles).
  for (const uid of userIds) {
    try {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[cleanup ${ns}] deleteUser ${uid}: ${error.message}`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[cleanup ${ns}] deleteUser ${uid}: ${(e as Error).message}`);
    }
  }

  registry.delete(ns);
}
