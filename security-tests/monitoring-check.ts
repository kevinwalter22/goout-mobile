#!/usr/bin/env npx tsx
/**
 * Security Monitoring Check
 *
 * Prints last 24h security event counts from the security_events table.
 * Must be run with an ADMIN account.
 *
 * Environment variables:
 *   SUPABASE_URL       (or EXPO_PUBLIC_SUPABASE_URL)
 *   SUPABASE_ANON_KEY  (or EXPO_PUBLIC_SUPABASE_ANON_KEY)
 *   ADMIN_EMAIL, ADMIN_PASSWORD
 *
 * Usage:
 *   npx tsx security-tests/monitoring-check.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY");
    process.exit(1);
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Missing ADMIN_EMAIL / ADMIN_PASSWORD");
    process.exit(1);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error: authErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (authErr) {
    console.error("Admin sign-in failed:", authErr.message);
    process.exit(1);
  }
  console.log(`Signed in as admin: ${data.user!.id}\n`);

  // Call admin summary RPC (last 1 day)
  const { data: summary, error: rpcErr } = await client.rpc(
    "get_security_event_summary",
    { p_days: 1 },
  );

  if (rpcErr) {
    console.error("RPC error:", rpcErr.message);
    process.exit(1);
  }

  console.log("══════════════════════════════════════════");
  console.log("  Security Events — Last 24 Hours");
  console.log("══════════════════════════════════════════");

  if (!summary || summary.length === 0) {
    console.log("\n  No security events in the last 24 hours.\n");
    console.log("══════════════════════════════════════════\n");
    process.exit(0);
  }

  // Group by severity for a quick tally
  const bySeverity: Record<string, number> = {};
  let total = 0;

  for (const row of summary) {
    const count = Number(row.event_count);
    total += count;
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + count;
  }

  console.log(`\n  Total: ${total}`);
  for (const sev of ["critical", "high", "medium", "low"]) {
    if (bySeverity[sev]) {
      const color = sev === "critical" || sev === "high" ? "\x1b[31m" : sev === "medium" ? "\x1b[33m" : "\x1b[32m";
      console.log(`  ${color}${sev}\x1b[0m: ${bySeverity[sev]}`);
    }
  }

  console.log("\n  Breakdown:");
  console.log("  ──────────────────────────────────────");
  console.log("  Date        Type                       Sev      Count  Users");
  console.log("  ──────────────────────────────────────");
  for (const row of summary) {
    const date = String(row.event_date).slice(0, 10);
    const type = String(row.event_type).padEnd(26);
    const sev = String(row.severity).padEnd(8);
    const count = String(row.event_count).padStart(5);
    const users = String(row.unique_users).padStart(5);
    console.log(`  ${date}  ${type} ${sev} ${count} ${users}`);
  }
  console.log("══════════════════════════════════════════\n");

  // Exit non-zero if any critical/high events
  if (bySeverity["critical"] || bySeverity["high"]) {
    console.log("  ⚠ Critical/high severity events detected — investigate!\n");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
