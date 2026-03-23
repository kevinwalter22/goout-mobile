#!/usr/bin/env npx tsx
/**
 * Euda Preflight Test Suite
 *
 * Integration tests covering auth, content flows, moderation, enforcement,
 * storage isolation, edge-function auth, and rate limiting against the live
 * Supabase backend.
 *
 * Environment variables:
 *   SUPABASE_URL              (or EXPO_PUBLIC_SUPABASE_URL)
 *   SUPABASE_ANON_KEY         (or EXPO_PUBLIC_SUPABASE_ANON_KEY)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NORMAL_EMAIL, NORMAL_PASSWORD  — normal (non-admin) user
 *   ADMIN_EMAIL, ADMIN_PASSWORD    — admin user
 *
 * Usage:
 *   npx tsx preflight-tests/run.ts
 *   npm run test:preflight
 */

// Load .env.local before anything else
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

// __DEV__ polyfill — textModeration.ts references this global
(globalThis as any).__DEV__ = false;

import { createClient, SupabaseClient, User, Session } from "@supabase/supabase-js";
import { moderateText, checkBeforeSubmit } from "../src/lib/moderation/textModeration";

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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const NORMAL_EMAIL = process.env.NORMAL_EMAIL || "";
const NORMAL_PASSWORD = process.env.NORMAL_PASSWORD || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const RUN_ID = `pflt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

function createServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function cleanup(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e: any) {
    console.log(`    ⚠ cleanup ${label}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// A: Auth + Profile
// ---------------------------------------------------------------------------
async function suiteA(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, adminUser: User,
) {
  group("A · Auth + Profile");

  // A.1 Normal reads own full profile
  const { data: ownProfile, error: e1 } = await normalClient
    .from("profiles").select("*").eq("id", normalUser.id).maybeSingle();
  record("Normal reads own full profile", !!ownProfile && !e1, e1?.message);

  // A.2 Own profile has sensitive columns
  if (ownProfile) {
    const hasSensitive = "is_admin" in ownProfile;
    record("Own profile includes is_admin column", hasSensitive);
  }

  // A.3 public_profiles for non-friend
  const { data: pubRow, error: e3 } = await normalClient
    .from("public_profiles").select("*").eq("id", adminUser.id).maybeSingle();
  record("public_profiles returns admin row", !!pubRow && !e3, e3?.message);

  if (pubRow) {
    const hasSensitive = "phone_hash" in pubRow || "is_admin" in pubRow;
    record("public_profiles hides sensitive fields",
      !hasSensitive,
      hasSensitive ? "EXPOSES sensitive columns!" : "safe");
  }

  // A.4 Admin is_current_user_admin
  const { data: isAdmin, error: e4 } = await adminClient.rpc("is_current_user_admin");
  record("Admin: is_current_user_admin returns true",
    isAdmin === true && !e4, e4?.message);
}

// ---------------------------------------------------------------------------
// B: Friend + Restricted Profile Views
// ---------------------------------------------------------------------------
async function suiteB(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, adminUser: User,
) {
  group("B · Friend + Restricted Profile Views");

  // Defensive pre-cleanup
  const svc = createServiceClient();
  await svc.from("friendships").delete()
    .or(`and(user_id.eq.${normalUser.id},friend_id.eq.${adminUser.id}),and(user_id.eq.${adminUser.id},friend_id.eq.${normalUser.id})`);

  // B.1 Normal sends friend request
  const { data: frInsert, error: e1 } = await normalClient
    .from("friendships")
    .insert({ user_id: normalUser.id, friend_id: adminUser.id, status: "pending" })
    .select("id")
    .single();
  record("Normal sends friend request", !!frInsert && !e1, e1?.message);

  // B.2 Pending: normal CANNOT read admin's full profile
  const { data: preAccept } = await normalClient
    .from("profiles").select("*").eq("id", adminUser.id).maybeSingle();
  record("Pending: normal CANNOT read admin full profile",
    !preAccept,
    preAccept ? "VISIBLE — RLS too permissive!" : "blocked");

  // B.3 Admin accepts
  const { error: acceptErr } = await adminClient
    .from("friendships")
    .update({ status: "accepted" })
    .eq("user_id", normalUser.id)
    .eq("friend_id", adminUser.id);
  record("Admin accepts friend request", !acceptErr, acceptErr?.message);

  // B.4 Accepted: normal CAN read admin's full profile
  const { data: postAccept } = await normalClient
    .from("profiles").select("*").eq("id", adminUser.id).maybeSingle();
  record("Accepted: normal CAN read admin full profile", !!postAccept);

  // Cleanup
  await cleanup("friendship", async () => {
    await svc.from("friendships").delete()
      .eq("user_id", normalUser.id).eq("friend_id", adminUser.id);
  });
}

// ---------------------------------------------------------------------------
// C: Core Content Flows
// ---------------------------------------------------------------------------
async function suiteC(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, _adminUser: User,
) {
  group("C · Core Content Flows");

  const caption = `preflight ${RUN_ID}`;

  // C.1 Normal creates a post
  const { data: post, error: e1 } = await normalClient
    .from("posts")
    .insert({
      user_id: normalUser.id,
      caption,
      camera_mode: "back",
      photo_path: `${normalUser.id}/pflt-c-${RUN_ID}.jpg`,
    })
    .select("id, caption, user_id")
    .single();
  record("Normal creates own post", !!post && !e1, e1?.message);
  const postId = post?.id;

  if (!postId) {
    record("Normal reads own post", false, "no post to read");
    record("Admin CANNOT delete normal's post", false, "no post");
    record("Normal deletes own post", false, "no post");
    return;
  }

  // C.2 Normal reads own post
  const { data: readPost } = await normalClient
    .from("posts").select("*").eq("id", postId).maybeSingle();
  record("Normal reads own post", !!readPost && readPost.caption === caption);

  // C.3 Admin CANNOT delete normal's post (RLS: auth.uid() = user_id)
  await adminClient.from("posts").delete().eq("id", postId);
  const { data: stillExists } = await normalClient
    .from("posts").select("id").eq("id", postId).maybeSingle();
  record("Admin CANNOT delete normal's post",
    !!stillExists,
    stillExists ? "still exists" : "DELETED — RLS missing!");

  // C.4 Normal deletes own post
  await normalClient.from("posts").delete().eq("id", postId);
  const { data: gone } = await normalClient
    .from("posts").select("id").eq("id", postId).maybeSingle();
  record("Normal deletes own post", !gone);

  // Cleanup
  await cleanup("suite-C posts", async () => {
    const svc = createServiceClient();
    await svc.from("posts").delete().like("caption", `%${RUN_ID}%`);
  });
}

// ---------------------------------------------------------------------------
// D: Moderation E2E
// ---------------------------------------------------------------------------
async function suiteD(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, adminUser: User,
) {
  group("D · Moderation E2E");

  // D.1 Text moderation — hate speech blocked
  const hateResult = checkBeforeSubmit("this is nigger content", "caption");
  record("Hate speech: checkBeforeSubmit blocks", hateResult.allowed === false);

  // D.2 Text moderation — mild profanity allowed in captions
  const mildResult = checkBeforeSubmit("damn this is cool", "caption");
  record("Mild profanity in caption: allowed", mildResult.allowed === true);

  // D.3 Text moderation — harassment blocked
  const harassResult = checkBeforeSubmit("kys", "comment");
  record("Harassment (kys): blocked", harassResult.allowed === false);

  // D.4 Text moderation — doxxing quarantined
  const doxxResult = moderateText("doxxing people is bad", "comment");
  record("Doxxing: action=quarantine",
    doxxResult.action === "quarantine",
    `got: ${doxxResult.action}`);

  // D.5 DB moderation flow — create clean post
  const { data: cleanPost, error: cpErr } = await normalClient.from("posts").insert({
    user_id: normalUser.id,
    caption: `clean ${RUN_ID}`,
    camera_mode: "back",
    photo_path: `${normalUser.id}/pflt-d-${RUN_ID}.jpg`,
  }).select("id").single();

  if (!cleanPost) {
    record("Create clean post for moderation flow", false, cpErr?.message);
    return;
  }

  // D.6 Admin inserts user_report flag
  const { error: flagErr } = await adminClient.from("moderation_flags").insert({
    flagged_by: adminUser.id,
    target_type: "post",
    target_id: cleanPost.id,
    source: "user_report",
    category: "spam",
    severity: 50,
    action: "quarantine",
    reason: `preflight report ${RUN_ID}`,
    status: "open",
  } as any);
  record("Admin inserts user_report flag", !flagErr, flagErr?.message);

  // D.7 get_moderation_inbox returns the flag
  const { data: inbox } = await adminClient.rpc("get_moderation_inbox", {
    p_limit: 50,
    p_offset: 0,
    p_source: "user_report",
  });
  const found = inbox?.some((f: any) => f.reason?.includes(RUN_ID));
  record("get_moderation_inbox returns the flag", !!found);

  // D.8 Admin blocks post via moderate_content
  const { error: blockErr } = await adminClient.rpc("moderate_content", {
    p_target_type: "post",
    p_target_id: cleanPost.id,
    p_action: "blocked",
    p_reason: `preflight block ${RUN_ID}`,
  });
  if (blockErr) {
    record("moderate_content blocks post", false, blockErr.message);
  } else {
    const { data: blockedPost } = await normalClient
      .from("posts").select("moderation_status").eq("id", cleanPost.id).maybeSingle();
    record("moderate_content blocks post",
      blockedPost?.moderation_status === "blocked",
      `status: ${blockedPost?.moderation_status}`);
  }

  // D.9 Service-role approves post (moderate_content RPC uses DB enum that
  // doesn't include "approved" — so we use service-role direct update)
  const svcD = createServiceClient();
  const { error: approveErr } = await svcD
    .from("posts")
    .update({
      moderation_status: "approved",
      moderation_reason: `preflight approve ${RUN_ID}`,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", cleanPost.id);
  if (approveErr) {
    record("Service-role approves blocked post", false, approveErr.message);
  } else {
    const { data: approvedPost } = await normalClient
      .from("posts").select("moderation_status").eq("id", cleanPost.id).maybeSingle();
    record("Service-role approves blocked post",
      approvedPost?.moderation_status === "approved",
      `status: ${approvedPost?.moderation_status}`);
  }

  // Cleanup
  await cleanup("suite-D", async () => {
    const svc = createServiceClient();
    await svc.from("moderation_flags").delete().like("reason", `%${RUN_ID}%`);
    await svc.from("posts").delete().like("caption", `%${RUN_ID}%`);
  });
}

// ---------------------------------------------------------------------------
// E: Enforcement
// ---------------------------------------------------------------------------
async function suiteE(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, _adminUser: User,
) {
  group("E · Enforcement");

  // E.1 Admin suspends normal user
  const { error: suspErr } = await adminClient.rpc("set_user_enforcement", {
    p_user_id: normalUser.id,
    p_is_suspended: true,
    p_suspended_until: null,
    p_is_shadowbanned: false,
    p_note: `preflight suspend ${RUN_ID}`,
  });
  record("Admin suspends normal user", !suspErr, suspErr?.message);

  // E.2 Normal checks enforcement — sees suspended
  const { data: enfCheck } = await normalClient.rpc("check_enforcement");
  const isSuspended = Array.isArray(enfCheck)
    ? enfCheck[0]?.is_suspended === true
    : enfCheck?.is_suspended === true;
  record("check_enforcement returns is_suspended=true", isSuspended);

  // E.3 Suspended user CAN still insert at DB level (enforcement is client-side)
  const { data: suspPost, error: suspPostErr } = await normalClient.from("posts").insert({
    user_id: normalUser.id,
    caption: `suspended ${RUN_ID}`,
    camera_mode: "back",
    photo_path: `${normalUser.id}/pflt-e3-${RUN_ID}.jpg`,
  }).select("id, moderation_status").single();
  record("Suspended user can create post (DB allows)",
    !!suspPost && !suspPostErr, suspPostErr?.message);

  // E.4 Admin shadowbans normal (lifts suspension)
  const { error: sbErr } = await adminClient.rpc("set_user_enforcement", {
    p_user_id: normalUser.id,
    p_is_suspended: false,
    p_suspended_until: null,
    p_is_shadowbanned: true,
    p_note: `preflight shadowban ${RUN_ID}`,
  });
  record("Admin shadowbans normal user", !sbErr, sbErr?.message);

  // E.5 Shadowbanned user creates post — trigger auto-quarantines
  const { data: sbPost, error: sbPostErr } = await normalClient.from("posts").insert({
    user_id: normalUser.id,
    caption: `shadowban ${RUN_ID}`,
    camera_mode: "back",
    photo_path: `${normalUser.id}/pflt-e5-${RUN_ID}.jpg`,
  }).select("id, moderation_status").single();
  record("Shadowban trigger auto-quarantines post",
    sbPost?.moderation_status === "quarantined" && !sbPostErr,
    `status: ${sbPost?.moderation_status}`);

  // E.6 Admin can see the quarantined post
  if (sbPost?.id) {
    const { data: adminSees } = await adminClient
      .from("posts").select("id").eq("id", sbPost.id).maybeSingle();
    record("Admin can see quarantined post", !!adminSees);
  } else {
    record("Admin can see quarantined post", false, "no post created");
  }

  // Cleanup
  await cleanup("suite-E", async () => {
    const svc = createServiceClient();
    await svc.from("user_enforcement").delete().eq("user_id", normalUser.id);
    await svc.from("moderation_actions").delete().like("reason", `%${RUN_ID}%`);
    await svc.from("posts").delete().like("caption", `%${RUN_ID}%`);
  });
}

// ---------------------------------------------------------------------------
// F: Storage Isolation
// ---------------------------------------------------------------------------
async function suiteF(
  normalClient: SupabaseClient, normalUser: User,
  adminClient: SupabaseClient, adminUser: User,
) {
  group("F · Storage Isolation");

  const blob = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // minimal JPEG stub
  const storagePath = `${normalUser.id}/preflight-${RUN_ID}.jpg`;

  // F.1 Normal uploads to own folder
  const { error: upErr } = await normalClient.storage
    .from("posts")
    .upload(storagePath, blob, { contentType: "image/jpeg", upsert: true });
  record("Normal uploads to own posts/ folder", !upErr, upErr?.message);

  // F.2 Admin CANNOT upload to normal's folder
  const { error: crossUp1 } = await adminClient.storage
    .from("posts")
    .upload(`${normalUser.id}/malicious-${RUN_ID}.jpg`, blob, { contentType: "image/jpeg" });
  record("Admin CANNOT upload to normal's folder",
    !!crossUp1,
    crossUp1 ? "blocked" : "UPLOADED — policy missing!");

  // F.3 Normal CANNOT upload to admin's folder
  const { error: crossUp2 } = await normalClient.storage
    .from("posts")
    .upload(`${adminUser.id}/malicious-${RUN_ID}.jpg`, blob, { contentType: "image/jpeg" });
  record("Normal CANNOT upload to admin's folder",
    !!crossUp2,
    crossUp2 ? "blocked" : "UPLOADED — policy missing!");

  // F.4 Normal deletes own file
  const { error: delErr } = await normalClient.storage
    .from("posts").remove([storagePath]);
  record("Normal deletes own file", !delErr, delErr?.message);

  // F.5 Admin CANNOT delete normal's file (re-upload first)
  await normalClient.storage
    .from("posts")
    .upload(storagePath, blob, { contentType: "image/jpeg", upsert: true });
  await adminClient.storage.from("posts").remove([storagePath]);
  // Verify file still exists by downloading
  const { data: stillThere } = await normalClient.storage
    .from("posts").download(storagePath);
  record("Admin CANNOT delete normal's file",
    !!stillThere,
    stillThere ? "still exists" : "DELETED — policy missing!");

  // Cleanup
  await cleanup("suite-F", async () => {
    await normalClient.storage.from("posts").remove([storagePath]);
    const svc = createServiceClient();
    await svc.storage.from("posts").remove([
      `${normalUser.id}/malicious-${RUN_ID}.jpg`,
      `${adminUser.id}/malicious-${RUN_ID}.jpg`,
    ]);
  });
}

// ---------------------------------------------------------------------------
// G: Edge Function Auth
// ---------------------------------------------------------------------------
async function suiteG(
  _normalClient: SupabaseClient, _normalUser: User,
  normalSession: Session,
) {
  group("G · Edge Function Auth — unauthenticated");

  const anonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  };

  // G.1 Internal functions reject anon key
  const internalFns = [
    "cache-place-photos", "cleanup-orphaned-media", "enrich-explore-item",
    "fetch-coordinator", "health-summary", "ingest-eventbrite",
    "ingest-google-places", "ingest-ticketmaster", "ingest-web-collector",
    "lookup-venue-images", "normalize-raw-events", "run-enrichment-queue",
    "schedule-enrichment",
  ];

  for (const fn of internalFns) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: anonHeaders,
      });
      record(`${fn} rejects non-service-role`,
        resp.status === 401 || resp.status === 403,
        `status=${resp.status}`);
    } catch (e: any) {
      record(`${fn}`, false, e.message);
    }
  }

  // G.2 User-facing functions — reject anon key (no valid user JWT)
  group("G · Edge Function Auth — user-facing");

  const userFns = ["delete-account", "fetch-place-details", "rerank-explore-items"];
  for (const fn of userFns) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: anonHeaders,
      });
      record(`${fn} rejects without JWT`,
        resp.status === 401,
        `status=${resp.status}`);
    } catch (e: any) {
      record(`${fn} rejects without JWT`, false, e.message);
    }
  }

  // G.3 moderate-image — user JWT should pass auth (may fail on body validation)
  const userHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${normalSession.access_token}`,
  };
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/moderate-image`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ bucket: "posts", path: "nonexistent/test.jpg" }),
    });
    // 404 = function not deployed (acceptable); 400/422 = auth passed, body validation failed (pass)
    // Only 401/403 = auth failure (fail)
    record("moderate-image auth check",
      resp.status !== 401 && resp.status !== 403,
      resp.status === 404 ? "not deployed (ok)" : `status=${resp.status}`);
  } catch (e: any) {
    record("moderate-image auth check", false, e.message);
  }
}

// ---------------------------------------------------------------------------
// H: Rate Limiting
// ---------------------------------------------------------------------------
async function suiteH(normalClient: SupabaseClient, normalUser: User) {
  group("H · Rate Limiting");

  // H.1 check_post_rate_limit callable
  const { error: postRL } = await normalClient.rpc("check_post_rate_limit");
  const postRateLimited = postRL?.message?.includes("Rate limit");
  record("check_post_rate_limit callable",
    !postRL || postRateLimited,
    postRateLimited ? "rate-limited from prior runs" : postRL?.message || "ok");

  // H.2 check_comment_rate_limit callable
  const { error: commentRL } = await normalClient.rpc("check_comment_rate_limit");
  const commentRateLimited = commentRL?.message?.includes("Rate limit");
  record("check_comment_rate_limit callable",
    !commentRL || commentRateLimited,
    commentRateLimited ? "rate-limited from prior runs" : commentRL?.message || "ok");

  // H.3 match_contacts rate limit (5/min)
  let hitLimit = false;
  for (let i = 1; i <= 7; i++) {
    const { error } = await normalClient.rpc("match_contacts", {
      p_user_id: normalUser.id,
      p_hashed_phones: ["nonexistent_hash"],
    });
    if (error?.message?.includes("Rate limit")) {
      hitLimit = true;
      record(`match_contacts rate-limited at call #${i}`, true,
        `hit at #${i} (limit=5/min)`);
      break;
    }
  }
  if (!hitLimit) {
    record("match_contacts rate limit NOT triggered after 7 calls", false,
      "limiter may not be active or window not reset");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!NORMAL_EMAIL || !NORMAL_PASSWORD || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Missing NORMAL_EMAIL, NORMAL_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD");
    process.exit(1);
  }

  console.log(`\nPreflight Test Suite — RUN_ID: ${RUN_ID}\n`);
  console.log("Signing in test accounts...");

  const normal = await signIn(NORMAL_EMAIL, NORMAL_PASSWORD);
  const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`  Normal: ${normal.user.id} (${NORMAL_EMAIL})`);
  console.log(`  Admin:  ${admin.user.id} (${ADMIN_EMAIL})`);

  // Run suites in order
  await suiteA(normal.client, normal.user, admin.client, admin.user);
  await suiteB(normal.client, normal.user, admin.client, admin.user);
  await suiteC(normal.client, normal.user, admin.client, admin.user);
  await suiteD(normal.client, normal.user, admin.client, admin.user);
  await suiteE(normal.client, normal.user, admin.client, admin.user);
  await suiteF(normal.client, normal.user, admin.client, admin.user);
  await suiteG(normal.client, normal.user, normal.session);
  await suiteH(normal.client, normal.user); // Last — burns rate limit quota

  // Summary
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
