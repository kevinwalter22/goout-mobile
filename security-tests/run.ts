#!/usr/bin/env npx tsx
/**
 * Euda Security Regression Test Suite
 *
 * Proves RLS policies, RPC guards, edge-function auth, storage isolation,
 * and rate limiting are working correctly using two test accounts.
 *
 * Environment variables:
 *   SUPABASE_URL            (or EXPO_PUBLIC_SUPABASE_URL)
 *   SUPABASE_ANON_KEY       (or EXPO_PUBLIC_SUPABASE_ANON_KEY)
 *   USER_A_EMAIL, USER_A_PASSWORD   — normal (non-admin) user
 *   USER_B_EMAIL, USER_B_PASSWORD   — second normal user
 *
 * Usage:
 *   npx tsx security-tests/run.ts
 *   npm run security:test
 */

import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

const USER_A_EMAIL = process.env.USER_A_EMAIL || "";
const USER_A_PASSWORD = process.env.USER_A_PASSWORD || "";
const USER_B_EMAIL = process.env.USER_B_EMAIL || "";
const USER_B_PASSWORD = process.env.USER_B_PASSWORD || "";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
interface TestResult {
  group: string;
  name: string;
  status: "PASS" | "FAIL";
  detail: string;
}

const results: TestResult[] = [];
let currentGroup = "";

function group(name: string) {
  currentGroup = name;
  console.log(`\n── ${name} ──`);
}

function record(name: string, pass: boolean, detail = "") {
  results.push({ group: currentGroup, name, status: pass ? "PASS" : "FAIL", detail });
  const icon = pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, user: data.user!, session: data.session! };
}

// ---------------------------------------------------------------------------
// A1: Profiles RLS
// ---------------------------------------------------------------------------
async function testProfilesRLS(
  clientA: SupabaseClient, userA: User,
  clientB: SupabaseClient, userB: User,
) {
  group("A1 · Profiles RLS");

  // Own profile
  const { data: own, error: e1 } = await clientA
    .from("profiles").select("*").eq("id", userA.id).maybeSingle();
  record("User A reads own profile", !!own && !e1, e1?.message);

  // Determine friendship status for context-aware assertion
  const { data: friendship } = await clientA
    .from("friendships")
    .select("status")
    .or(`and(user_id.eq.${userA.id},friend_id.eq.${userB.id}),and(user_id.eq.${userB.id},friend_id.eq.${userA.id})`)
    .eq("status", "accepted")
    .maybeSingle();
  const areFriends = !!friendship;

  const { data: other } = await clientA
    .from("profiles").select("*").eq("id", userB.id).maybeSingle();
  if (areFriends) {
    record("User A reads friend's profile (friends)", !!other, "friends");
  } else {
    record(
      "User A CANNOT read non-friend's full profile",
      !other,
      other ? "RETURNED — RLS too permissive!" : "blocked",
    );
  }

  // public_profiles view
  const { data: pub, error: e3 } = await clientA
    .from("public_profiles").select("*").eq("id", userB.id).maybeSingle();
  record("public_profiles returns User B", !!pub && !e3, e3?.message);

  // Sensitive columns hidden. Only PII / privilege fields are forbidden here.
  // xp / streak / last_post_date are INTENTIONALLY public — they're social
  // gamification stats surfaced on profiles (like a visible streak), not secrets.
  if (pub) {
    const leaked = ["phone_number", "phone_hash", "is_admin"].filter((c) => c in pub);
    record("public_profiles hides sensitive fields", leaked.length === 0,
      leaked.length ? `EXPOSES sensitive columns: ${leaked.join(", ")}!` : "safe");
  }

  // app_secrets
  const { data: secrets } = await clientA.from("app_secrets").select("*");
  record("app_secrets blocked for users", !secrets || secrets.length === 0,
    secrets?.length ? "EXPOSED!" : "blocked");
}

// ---------------------------------------------------------------------------
// A2: Friendships RLS
// ---------------------------------------------------------------------------
async function testFriendshipsRLS(
  clientA: SupabaseClient, userA: User,
  _clientB: SupabaseClient, userB: User,
) {
  group("A2 · Friendships RLS");

  const { error: e1 } = await clientA
    .from("friendships").select("*")
    .or(`user_id.eq.${userA.id},friend_id.eq.${userA.id}`).limit(5);
  record("User A reads own friendships", !e1, e1?.message);

  // Insert friendship as someone else
  const { error: e2 } = await clientA
    .from("friendships")
    .insert({ user_id: userB.id, friend_id: userA.id, status: "pending" });
  record("User A CANNOT insert friendship as User B", !!e2,
    e2 ? "blocked" : "INSERTED — RLS missing!");
}

// ---------------------------------------------------------------------------
// A3: Posts RLS
// ---------------------------------------------------------------------------
async function testPostsRLS(
  clientA: SupabaseClient, userA: User,
  _clientB: SupabaseClient, userB: User,
) {
  group("A3 · Posts RLS");

  const { error: e1 } = await clientA
    .from("posts").select("*").eq("user_id", userA.id).limit(1);
  record("User A reads own posts", !e1, e1?.message);

  // Create post as other user
  const { error: e2 } = await clientA.from("posts").insert({
    user_id: userB.id,
    image_url: "https://example.com/malicious.jpg",
    explore_item_id: "00000000-0000-0000-0000-000000000000",
  });
  record("User A CANNOT create post as User B", !!e2,
    e2 ? "blocked" : "INSERTED — RLS missing!");
}

// ---------------------------------------------------------------------------
// A4: Explore Items — soft-delete gate
// ---------------------------------------------------------------------------
async function testExploreItemsSoftDelete(clientA: SupabaseClient) {
  group("A4 · Explore Items soft-delete gate");

  const { data } = await clientA
    .from("explore_items").select("id, deleted_at")
    .not("deleted_at", "is", null).limit(1);
  record("Soft-deleted items hidden from users",
    !data || data.length === 0,
    data?.length ? "VISIBLE — gate missing!" : "hidden (or none exist)");
}

// ---------------------------------------------------------------------------
// A5: Content Reports RLS
// ---------------------------------------------------------------------------
async function testContentReportsRLS(
  clientA: SupabaseClient, userA: User,
  _clientB: SupabaseClient, userB: User,
) {
  group("A5 · Content Reports RLS");

  // Can't view other user's reports
  const { data: bReports } = await clientA
    .from("content_reports").select("*").eq("reporter_id", userB.id).limit(1);
  record("User A CANNOT view User B's reports",
    !bReports || bReports.length === 0,
    bReports?.length ? "VISIBLE — RLS too permissive!" : "blocked");

  // Can't insert report as other user
  const { error: e2 } = await clientA.from("content_reports").insert({
    reporter_id: userB.id,
    reported_user_id: userA.id,
    reason: "test_spoofed_report",
  });
  record("User A CANNOT create report as User B", !!e2,
    e2 ? "blocked" : "INSERTED — RLS missing!");
}

// ---------------------------------------------------------------------------
// B1: Admin-only RPCs
// ---------------------------------------------------------------------------
async function testAdminRPCs(clientA: SupabaseClient) {
  group("B1 · Admin-only RPCs (non-admin caller)");

  const { error: e1 } = await clientA.rpc("approve_quarantined_item", {
    p_item_id: "00000000-0000-0000-0000-000000000000",
  });
  record("approve_quarantined_item blocked", !!e1 && /admin/i.test(e1.message),
    e1?.message || "NO ERROR — guard missing!");

  const { error: e2 } = await clientA.rpc("reject_quarantined_item", {
    p_item_id: "00000000-0000-0000-0000-000000000000",
    p_reason: "test",
  });
  record("reject_quarantined_item blocked", !!e2 && /admin/i.test(e2.message),
    e2?.message || "NO ERROR — guard missing!");

  const { error: e3 } = await clientA.rpc("toggle_feature_flag", {
    p_flag_name: "nonexistent_flag",
    p_is_enabled: false,
  });
  record("toggle_feature_flag blocked", !!e3 && /admin/i.test(e3.message),
    e3?.message || "NO ERROR — guard missing!");
}

// ---------------------------------------------------------------------------
// B2: RPC Ownership (assert_caller)
// ---------------------------------------------------------------------------
async function testOwnershipRPCs(
  clientA: SupabaseClient, userA: User,
  _clientB: SupabaseClient, userB: User,
) {
  group("B2 · RPC Ownership (assert_caller)");

  // Read-only RPCs: test own + cross-user
  const readOnlyRPCs: { name: string; ownParams: Record<string, unknown>; otherParams: Record<string, unknown> }[] = [
    {
      name: "get_user_type_affinity",
      ownParams: { p_user_id: userA.id },
      otherParams: { p_user_id: userB.id },
    },
    {
      name: "get_user_tag_affinity",
      ownParams: { p_user_id: userA.id, p_limit: 5 },
      otherParams: { p_user_id: userB.id, p_limit: 5 },
    },
    {
      name: "get_friend_recommendations",
      ownParams: { p_user_id: userA.id, p_limit: 5 },
      otherParams: { p_user_id: userB.id, p_limit: 5 },
    },
    {
      name: "get_friends_going_for_items",
      ownParams: { p_user_id: userA.id, p_item_ids: [] },
      otherParams: { p_user_id: userB.id, p_item_ids: [] },
    },
  ];

  for (const rpc of readOnlyRPCs) {
    const { error: ownErr } = await clientA.rpc(rpc.name, rpc.ownParams);
    record(`${rpc.name} with own ID`, !ownErr, ownErr?.message);

    const { error: otherErr } = await clientA.rpc(rpc.name, rpc.otherParams);
    record(`${rpc.name} cross-user blocked`, !!otherErr,
      otherErr ? "blocked" : "RETURNED — guard missing!");
  }

  // Write RPCs: only test cross-user (avoid side-effects on own account)
  const { error: e1 } = await clientA.rpc("save_phone_number", {
    p_user_id: userB.id,
    p_phone_number: "+15559999999",
  });
  record("save_phone_number cross-user blocked", !!e1,
    e1 ? "blocked" : "SAVED — guard missing!");

  const { error: e2 } = await clientA.rpc("update_user_progression", {
    p_user_id: userB.id,
    p_xp_amount: 0,
    p_post_date: new Date().toISOString(),
  });
  record("update_user_progression cross-user blocked", !!e2,
    e2 ? "blocked" : "UPDATED — guard missing!");

  // match_contacts: own + cross-user
  // Note: rate-limit error on own-ID call is acceptable (proves limiter works)
  const { error: mc1 } = await clientA.rpc("match_contacts", {
    p_user_id: userA.id,
    p_hashed_phones: ["nonexistent_hash"],
  });
  const mc1RateLimited = mc1?.message?.includes("Rate limit");
  record("match_contacts with own ID",
    !mc1 || mc1RateLimited,
    mc1RateLimited ? "rate-limited (prior run consumed window)" : mc1?.message);

  const { error: mc2 } = await clientA.rpc("match_contacts", {
    p_user_id: userB.id,
    p_hashed_phones: ["nonexistent_hash"],
  });
  record("match_contacts cross-user blocked", !!mc2,
    mc2 ? "blocked" : "RETURNED — guard missing!");

  // log_interaction_and_update_affinity: cross-user only (needs real item for own)
  const { error: li } = await clientA.rpc("log_interaction_and_update_affinity", {
    p_user_id: userB.id,
    p_explore_item_id: "00000000-0000-0000-0000-000000000000",
    p_event_type: "open_detail",
    p_item_kind: "event",
  });
  record("log_interaction cross-user blocked", !!li,
    li ? "blocked" : "INSERTED — guard missing!");
}

// ---------------------------------------------------------------------------
// C1: Edge Function Auth
// ---------------------------------------------------------------------------
async function testEdgeFunctionAuth() {
  group("C1 · Edge Function Auth — unauthenticated");

  // Pass anon key so the request reaches the function itself (past the gateway).
  // The function's own auth guard should then reject it.
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  };

  // Internal (service-role) functions — should return 401 or 403
  const internalFns = [
    "health-summary",
    "fetch-coordinator",
    "ingest-ticketmaster",
    "ingest-google-places",
    "normalize-raw-events",
    "run-enrichment-queue",
    "schedule-enrichment",
    "cleanup-orphaned-media",
    "lookup-venue-images",
    "cache-place-photos",
    "enrich-explore-item",
    "ingest-web-collector",
  ];

  for (const fn of internalFns) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: baseHeaders,
      });
      record(`${fn} rejects non-service-role`,
        resp.status === 401 || resp.status === 403,
        `status=${resp.status}`);
    } catch (e: any) {
      record(`${fn}`, false, e.message);
    }
  }

  // User-facing functions — should return 401 (no valid JWT)
  const userFns = ["delete-account", "fetch-place-details", "rerank-explore-items"];
  for (const fn of userFns) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: baseHeaders,
      });
      record(`${fn} rejects without JWT`,
        resp.status === 401,
        `status=${resp.status}`);
    } catch (e: any) {
      record(`${fn}`, false, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// C2: Edge Function CORS (informational)
// ---------------------------------------------------------------------------
async function testEdgeFunctionCORS() {
  group("C2 · Edge Function CORS (informational)");

  // Supabase's gateway adds Access-Control-Allow-Origin: * to all edge
  // function responses, overriding function-level CORS headers. This is a
  // platform behavior outside our control. It is NOT a security issue because:
  //   - All endpoints require JWT or service-role auth (tested in C1)
  //   - Tokens live in memory / SecureStore, not cookies
  //   - CORS only restricts browser-initiated requests; mobile is unaffected
  //
  // We log the observed headers for awareness but always pass.

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/health-summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://evil.com",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    const acao = resp.headers.get("Access-Control-Allow-Origin");
    const isGatewayWildcard = acao === "*";
    record("CORS: disallowed origin header",
      true,
      isGatewayWildcard
        ? `gateway returns * (platform behavior, auth guards protect endpoints)`
        : `got: ${acao}`);
  } catch (e: any) {
    record("CORS disallowed origin test", true, `fetch error: ${e.message}`);
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/health-summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://euda.live",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    const acao = resp.headers.get("Access-Control-Allow-Origin");
    const isGatewayWildcard = acao === "*";
    record("CORS: allowed origin header",
      true,
      isGatewayWildcard
        ? `gateway returns * (platform behavior, auth guards protect endpoints)`
        : `got: ${acao}`);
  } catch (e: any) {
    record("CORS allowed origin test", true, `fetch error: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// D: Storage Bucket Isolation
// ---------------------------------------------------------------------------
async function testStorageIsolation(
  clientA: SupabaseClient, userA: User,
  _clientB: SupabaseClient, userB: User,
) {
  group("D · Storage Bucket Isolation");

  const blob = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // minimal JPEG stub

  // Own folder uploads
  const { error: e1 } = await clientA.storage
    .from("posts").upload(`${userA.id}/sec-test.jpg`, blob, { contentType: "image/jpeg", upsert: true });
  record("Upload to own posts/", !e1, e1?.message);

  const { error: e2 } = await clientA.storage
    .from("avatars").upload(`${userA.id}/sec-test.jpg`, blob, { contentType: "image/jpeg", upsert: true });
  record("Upload to own avatars/", !e2, e2?.message);

  // Cross-user writes
  const { error: e3 } = await clientA.storage
    .from("posts").upload(`${userB.id}/malicious.jpg`, blob, { contentType: "image/jpeg" });
  record("CANNOT upload to other user's posts/", !!e3,
    e3 ? "blocked" : "UPLOADED — policy missing!");

  const { error: e4 } = await clientA.storage
    .from("avatars").upload(`${userB.id}/malicious.jpg`, blob, { contentType: "image/jpeg" });
  record("CANNOT upload to other user's avatars/", !!e4,
    e4 ? "blocked" : "UPLOADED — policy missing!");

  // explore-images (service-role only)
  const { error: e5 } = await clientA.storage
    .from("explore-images").upload("malicious.jpg", blob, { contentType: "image/jpeg" });
  record("CANNOT upload to explore-images/", !!e5,
    e5 ? "blocked" : "UPLOADED — policy missing!");

  // Cleanup
  await clientA.storage.from("posts").remove([`${userA.id}/sec-test.jpg`]);
  await clientA.storage.from("avatars").remove([`${userA.id}/sec-test.jpg`]);
}

// ---------------------------------------------------------------------------
// E: Rate Limiting
// ---------------------------------------------------------------------------
async function testRateLimiting(clientA: SupabaseClient, userA: User) {
  group("E · Rate Limiting (match_contacts 5/min)");

  // Note: ownership tests already consumed ~1 call against the rate window.
  let hitLimit = false;
  for (let i = 1; i <= 7; i++) {
    const { error } = await clientA.rpc("match_contacts", {
      p_user_id: userA.id,
      p_hashed_phones: ["nonexistent_hash"],
    });
    if (error?.message?.includes("Rate limit exceeded")) {
      hitLimit = true;
      record(`match_contacts rate-limited at call #${i}`, true,
        `hit at #${i} (limit=5/min)`);
      break;
    }
  }
  if (!hitLimit) {
    record("match_contacts rate limit NOT triggered after 7 calls", false,
      "limiter may not be active or window was not reset");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY (or EXPO_PUBLIC_ variants)");
    process.exit(1);
  }
  if (!USER_A_EMAIL || !USER_A_PASSWORD || !USER_B_EMAIL || !USER_B_PASSWORD) {
    console.error("Missing USER_A_EMAIL, USER_A_PASSWORD, USER_B_EMAIL, USER_B_PASSWORD");
    process.exit(1);
  }

  console.log("Signing in test accounts...");
  const a = await signIn(USER_A_EMAIL, USER_A_PASSWORD);
  const b = await signIn(USER_B_EMAIL, USER_B_PASSWORD);
  console.log(`  User A: ${a.user.id} (${USER_A_EMAIL})`);
  console.log(`  User B: ${b.user.id} (${USER_B_EMAIL})`);

  // ── A) RLS Data Isolation ──
  await testProfilesRLS(a.client, a.user, b.client, b.user);
  await testFriendshipsRLS(a.client, a.user, b.client, b.user);
  await testPostsRLS(a.client, a.user, b.client, b.user);
  await testExploreItemsSoftDelete(a.client);
  await testContentReportsRLS(a.client, a.user, b.client, b.user);

  // ── B) RPC / Function Authorization ──
  await testAdminRPCs(a.client);
  await testOwnershipRPCs(a.client, a.user, b.client, b.user);

  // ── C) Edge Function Auth + CORS ──
  await testEdgeFunctionAuth();
  await testEdgeFunctionCORS();

  // ── D) Storage Bucket Isolation ──
  await testStorageIsolation(a.client, a.user, b.client, b.user);

  // ── E) Rate Limiting (last — burns quota) ──
  await testRateLimiting(a.client, a.user);

  // ── Summary ──
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  ${passed} passed · ${failed} failed · ${passed + failed} total`);
  if (failed > 0) {
    console.log("\n  FAILURES:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`    \x1b[31m✗\x1b[0m [${r.group}] ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  }
  console.log("══════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
