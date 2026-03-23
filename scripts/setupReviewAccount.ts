#!/usr/bin/env tsx
/**
 * Setup App Store Review Account
 *
 * Creates (or resets) a deterministic test account for Apple App Review.
 * Uses the Supabase service_role key to manage auth + profile.
 *
 * Credentials are loaded from .env.local (gitignored):
 *   REVIEW_EMAIL, REVIEW_PASSWORD
 *
 * Usage:
 *   npx tsx scripts/setupReviewAccount.ts
 *   npx tsx scripts/setupReviewAccount.ts --reset   # deletes and recreates
 */

import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local first (secrets), then .env (public defaults)
dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// ── Config ─────────────────────────────────────────────────────
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const REVIEW_EMAIL = process.env.REVIEW_EMAIL || "developer@euda.live";
const REVIEW_PASSWORD = process.env.REVIEW_PASSWORD || "";

const REVIEW_USERNAME = "euda_reviewer";
const REVIEW_BIO = "App Store review account";

// Location: downtown Potsdam, NY — Market St & Main St intersection
const POTSDAM_LAT = 44.6697;
const POTSDAM_LNG = -74.9811;

// ── Validation ─────────────────────────────────────────────────
function validate() {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!REVIEW_PASSWORD) missing.push("REVIEW_PASSWORD");
  if (!REVIEW_EMAIL) missing.push("REVIEW_EMAIL");

  if (missing.length) {
    console.error("Missing required environment variables:");
    missing.forEach((v) => console.error(`  - ${v}`));
    console.error("\nAdd them to .env.local (gitignored).");
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  validate();

  const resetMode = process.argv.includes("--reset");

  // Service-role client bypasses RLS
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\nEuda App Review Account Setup`);
  console.log(`Email:    ${REVIEW_EMAIL}`);
  console.log(`Username: ${REVIEW_USERNAME}`);
  console.log(`Mode:     ${resetMode ? "RESET (delete + recreate)" : "ensure exists"}\n`);

  // ── Step 1: Check if user already exists ───────────────────
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(
    (u) => u.email === REVIEW_EMAIL
  );

  if (existing && resetMode) {
    console.log("Deleting existing review account...");
    // Profile will cascade-delete via FK
    const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
    if (delErr) {
      console.error("Failed to delete user:", delErr.message);
      process.exit(1);
    }
    console.log("  Deleted.");
  } else if (existing && !resetMode) {
    console.log("User already exists. Ensuring profile is correct...");
    await ensureProfile(admin, existing.id);
    await ensureSeedData(admin, existing.id);
    console.log("\nDone! Review account is ready.");
    return;
  }

  // ── Step 2: Create the user ────────────────────────────────
  console.log("Creating review user...");
  const { data: newUser, error: createErr } =
    await admin.auth.admin.createUser({
      email: REVIEW_EMAIL,
      password: REVIEW_PASSWORD,
      email_confirm: true, // auto-confirm so reviewer can log in immediately
      user_metadata: { username: REVIEW_USERNAME },
    });

  if (createErr) {
    console.error("Failed to create user:", createErr.message);
    process.exit(1);
  }

  const userId = newUser.user.id;
  console.log(`  Created user: ${userId}`);

  // ── Step 3: Ensure profile ─────────────────────────────────
  // The handle_new_user trigger should create the profile automatically.
  // Wait a moment for the trigger to fire, then update profile fields.
  await sleep(1000);
  await ensureProfile(admin, userId);

  // ── Step 4: Seed data ──────────────────────────────────────
  await ensureSeedData(admin, userId);

  console.log("\nDone! Review account is ready.");
  console.log(`\n  Email:    ${REVIEW_EMAIL}`);
  console.log(`  Password: (stored in .env.local as REVIEW_PASSWORD)`);
  console.log(`  Username: ${REVIEW_USERNAME}\n`);
}

// ── Helpers ────────────────────────────────────────────────────

async function ensureProfile(
  admin: ReturnType<typeof createClient>,
  userId: string
) {
  console.log("Updating profile...");

  const { error } = await admin
    .from("profiles")
    .update({
      username: REVIEW_USERNAME,
      bio: REVIEW_BIO,
    })
    .eq("id", userId);

  if (error) {
    // If profile doesn't exist yet (trigger race), insert it
    if (error.code === "PGRST116") {
      console.log("  Profile not found, inserting...");
      const { error: insertErr } = await admin.from("profiles").insert({
        id: userId,
        username: REVIEW_USERNAME,
        bio: REVIEW_BIO,
      });
      if (insertErr) {
        console.error("  Failed to insert profile:", insertErr.message);
      } else {
        console.log("  Profile inserted.");
      }
    } else {
      console.error("  Failed to update profile:", error.message);
    }
  } else {
    console.log("  Profile updated.");
  }
}

async function ensureSeedData(
  admin: ReturnType<typeof createClient>,
  userId: string
) {
  console.log("Seeding review data...");

  // Seed a couple of explore items near downtown Potsdam so the reviewer
  // sees content on the map and in the feed.
  const reviewItems = [
    {
      title: "Potsdam Farmers Market",
      description:
        "Fresh local produce, baked goods, and crafts every Saturday morning in downtown Potsdam.",
      kind: "event",
      category: "Food & Drink",
      price_bucket: "free",
      lat: 44.6700,
      lng: -74.9815,
      location_name: "Ives Park",
      town: "Potsdam",
      created_by_user_id: userId,
    },
    {
      title: "Downtown Coffee & Study",
      description:
        "A cozy spot for coffee and studying in the heart of Potsdam's Market Street.",
      kind: "activity",
      category: "Coffee & Tea",
      price_bucket: "free",
      lat: 44.6695,
      lng: -74.9808,
      location_name: "Market Street",
      town: "Potsdam",
      created_by_user_id: userId,
    },
  ];

  for (const item of reviewItems) {
    // Check if already seeded (by title + created_by)
    const { data: existing } = await admin
      .from("explore_items")
      .select("id")
      .eq("title", item.title)
      .eq("created_by_user_id", userId)
      .maybeSingle();

    if (existing) {
      console.log(`  "${item.title}" already exists, skipping.`);
      continue;
    }

    const { error } = await admin.from("explore_items").insert(item);
    if (error) {
      console.log(`  Warning: Could not seed "${item.title}": ${error.message}`);
    } else {
      console.log(`  Seeded: "${item.title}"`);
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
