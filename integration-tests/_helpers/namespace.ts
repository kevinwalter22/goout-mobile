/**
 * Per-run test-data namespace.
 *
 * Every integration test file creates its own namespace in beforeAll and tears
 * it down in afterAll. The namespace string is woven into every row a test
 * creates (test-user email, explore_item external_id, etc.) so that:
 *   - parallel or repeated runs never collide, and
 *   - cleanup can delete exactly and only what a run created.
 *
 * Format: <prefix>_t<base36 time>_<6 random chars>  e.g. "post_t1a2b3c_x9f2qa"
 */
import { randomBytes } from "crypto";

export function newNamespace(prefix: string): string {
  const t = Date.now().toString(36);
  const rand = randomBytes(4).toString("hex").slice(0, 6);
  return `${prefix}_t${t}_${rand}`;
}

/** Stable e-mail for an ephemeral test user inside a namespace. */
export function testUserEmail(ns: string, suffix = ""): string {
  // @euda-test.invalid is a guaranteed-undeliverable TLD; these accounts are
  // service-role created and deleted within the same test run.
  return `it_${ns}${suffix ? "_" + suffix : ""}@euda-test.invalid`.toLowerCase();
}

/** A recognizable marker substring present in all test-created free-text. */
export const TEST_MARKER = "[euda-it]";
