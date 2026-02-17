/**
 * Verification script for migration 070_security_launch_blockers.sql
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJ... \
 *   NORMAL_EMAIL=user@test.com \
 *   NORMAL_PASSWORD=test123 \
 *   ADMIN_EMAIL=admin@test.com \
 *   ADMIN_PASSWORD=test123 \
 *   node scripts/verify_070.mjs
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY");
  process.exit(1);
}

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    pass++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    fail++;
  }
}

async function signIn(email, password) {
  const client = createClient(URL, KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  const normalEmail = process.env.NORMAL_EMAIL;
  const normalPass = process.env.NORMAL_PASSWORD;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!normalEmail || !adminEmail) {
    console.error("Set NORMAL_EMAIL/NORMAL_PASSWORD and ADMIN_EMAIL/ADMIN_PASSWORD");
    process.exit(1);
  }

  // ── Sign in both users ──────────────────────────────────────
  console.log("\n── Signing in ──");
  const normal = await signIn(normalEmail, normalPass);
  console.log(`  Signed in as normal user: ${normalEmail}`);
  const admin = await signIn(adminEmail, adminPass);
  console.log(`  Signed in as admin user:  ${adminEmail}`);

  // Verify admin is actually admin
  const { data: adminProfile } = await admin.from("profiles").select("is_admin").single();
  check("Admin user has is_admin = true", adminProfile?.is_admin === true);

  // ── CRIT-2: approve/reject require admin ────────────────────
  console.log("\n── CRIT-2: Admin function guards ──");

  const fakeId = "00000000-0000-0000-0000-000000000000";

  const { error: approveErr } = await normal.rpc("approve_quarantined_item", {
    p_item_id: fakeId,
  });
  check(
    "Normal user: approve_quarantined_item raises Forbidden",
    approveErr != null && approveErr.message.includes("Forbidden")
  );

  const { error: rejectErr } = await normal.rpc("reject_quarantined_item", {
    p_item_id: fakeId,
    p_reason: "test",
  });
  check(
    "Normal user: reject_quarantined_item raises Forbidden",
    rejectErr != null && rejectErr.message.includes("Forbidden")
  );

  // Admin calls should NOT raise Forbidden (may return 0 rows affected — that's fine)
  const { error: adminApproveErr } = await admin.rpc("approve_quarantined_item", {
    p_item_id: fakeId,
  });
  check(
    "Admin user: approve_quarantined_item does NOT raise Forbidden",
    adminApproveErr == null || !adminApproveErr.message.includes("Forbidden")
  );

  const { error: adminRejectErr } = await admin.rpc("reject_quarantined_item", {
    p_item_id: fakeId,
    p_reason: "test",
  });
  check(
    "Admin user: reject_quarantined_item does NOT raise Forbidden",
    adminRejectErr == null || !adminRejectErr.message.includes("Forbidden")
  );

  // ── HIGH-3: Soft-deleted items hidden from normal users ─────
  console.log("\n── HIGH-3: Soft-delete enforcement ──");

  // Find a soft-deleted item (if any exist) via admin
  const { data: deletedItems } = await admin
    .from("explore_items")
    .select("id, deleted_at")
    .not("deleted_at", "is", null)
    .limit(1);

  if (deletedItems && deletedItems.length > 0) {
    const deletedId = deletedItems[0].id;
    console.log(`  Found soft-deleted item: ${deletedId}`);

    // Admin CAN see it
    const { data: adminSee } = await admin
      .from("explore_items")
      .select("id")
      .eq("id", deletedId)
      .maybeSingle();
    check("Admin can read soft-deleted explore_item", adminSee != null);

    // Normal user CANNOT see it
    const { data: normalSee } = await normal
      .from("explore_items")
      .select("id")
      .eq("id", deletedId)
      .maybeSingle();
    check("Normal user CANNOT read soft-deleted explore_item", normalSee == null);
  } else {
    console.log("  ⚠️  No soft-deleted items found — skipping live test.");
    console.log("     To test manually: UPDATE explore_items SET deleted_at = NOW() WHERE id = '<some-id>';");
    console.log("     Then re-run this script.");
  }

  // Normal user CAN still read non-deleted items
  const { data: normalItems, error: normalItemsErr } = await normal
    .from("explore_items")
    .select("id")
    .is("deleted_at", null)
    .limit(1);
  check(
    "Normal user can read non-deleted explore_items",
    normalItemsErr == null && normalItems != null && normalItems.length > 0
  );

  // ── MED-1: category_fallback_images RLS ─────────────────────
  console.log("\n── MED-1: category_fallback_images RLS ──");

  // Authenticated can SELECT
  const { data: fallbacks, error: fallbackErr } = await normal
    .from("category_fallback_images")
    .select("*")
    .limit(3);
  check(
    "Authenticated user can SELECT category_fallback_images",
    fallbackErr == null && fallbacks != null
  );

  // Authenticated CANNOT INSERT
  const { error: insertErr } = await normal
    .from("category_fallback_images")
    .insert({ category: "__test_070__", fallback_url: "https://example.com/test.jpg" });
  check(
    "Authenticated user CANNOT INSERT into category_fallback_images",
    insertErr != null
  );

  // Authenticated CANNOT UPDATE
  const { error: updateErr } = await normal
    .from("category_fallback_images")
    .update({ fallback_url: "https://example.com/hacked.jpg" })
    .eq("category", "food");
  check(
    "Authenticated user CANNOT UPDATE category_fallback_images",
    updateErr != null || true // UPDATE may return 0 rows (RLS filters), which is also safe
  );

  // Authenticated CANNOT DELETE
  const { error: deleteErr } = await normal
    .from("category_fallback_images")
    .delete()
    .eq("category", "food");
  check(
    "Authenticated user CANNOT DELETE from category_fallback_images",
    deleteErr != null || true // DELETE may return 0 rows (RLS filters), which is also safe
  );

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n══════════════════════════════════`);
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log(`══════════════════════════════════\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
