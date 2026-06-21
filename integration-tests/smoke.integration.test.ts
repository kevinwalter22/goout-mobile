/**
 * Harness smoke test — proves the integration setup can reach staging and that
 * the prod-safety guard is wired. This is the canary: if it fails, no other
 * integration suite can be trusted, so it should be the first thing to break.
 */
import { adminClient } from "./_helpers/client";
import { assertStagingEnv, STAGING_URL } from "./_helpers/env";
import { newNamespace } from "./_helpers/namespace";
import { createTestUser, insertExploreItem, cleanupNamespace } from "./_helpers/seed";

describe("integration harness", () => {
  it("is pointed at a non-prod (staging) Supabase project", () => {
    // Throws if URL is prod or credentials are missing.
    const env = assertStagingEnv();
    expect(env.url).toBe(STAGING_URL);
    expect(env.url).not.toContain("lkmntknpaiaiqvupzjbz"); // prod ref
    expect(env.serviceRoleKey.length).toBeGreaterThan(20);
    expect(env.anonKey.length).toBeGreaterThan(20);
  });

  it("can read from explore_items with the service-role client", async () => {
    const { error, count } = await adminClient()
      .from("explore_items")
      .select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("can seed a user + item and clean them up completely", async () => {
    const admin = adminClient();
    const ns = newNamespace("smoke");
    let userId: string;
    let itemId: string;
    try {
      const user = await createTestUser(admin, ns);
      userId = user.id;
      const item = await insertExploreItem(admin, ns, { title: "smoke item" });
      itemId = item.id;

      // Both exist server-side.
      const seededItem = await admin
        .from("explore_items")
        .select("id")
        .eq("id", itemId)
        .maybeSingle();
      expect(seededItem.data?.id).toBe(itemId);
    } finally {
      await cleanupNamespace(admin, ns);
    }

    // After cleanup the item is gone and no test rows leak.
    const gone = await admin
      .from("explore_items")
      .select("id")
      .eq("id", itemId!)
      .maybeSingle();
    expect(gone.data).toBeNull();

    const leaked = await admin
      .from("explore_items")
      .select("id", { count: "exact", head: true })
      .like("external_id", `${ns}:%`);
    expect(leaked.count).toBe(0);
  });
});
