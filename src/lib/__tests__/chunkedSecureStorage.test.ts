import { createChunkedSecureStorage } from "../chunkedSecureStorage";

/** In-memory SecureStore mock that ENFORCES the real 2048-byte cap (throws),
 *  exactly like expo-secure-store — so the test proves the adapter handles it. */
function mockSecureStore(cap = 2048) {
  const store = new Map<string, string>();
  return {
    _store: store,
    getItemAsync: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItemAsync: async (k: string, v: string) => {
      if (v.length > cap) throw new Error("Value is too large for SecureStore (2048 byte limit)");
      store.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      store.delete(k);
    },
  };
}

describe("chunkedSecureStorage", () => {
  it("round-trips a small value inline", async () => {
    const ss = mockSecureStore();
    const s = createChunkedSecureStorage(ss);
    await s.setItem("sb-auth", "small-session");
    expect(await s.getItem("sb-auth")).toBe("small-session");
  });

  it("round-trips a LARGE value (>2048) that would otherwise throw", async () => {
    const ss = mockSecureStore();
    const s = createChunkedSecureStorage(ss);
    const big = "x".repeat(5000); // exceeds the 2048 cap
    await s.setItem("sb-auth", big); // must NOT throw
    expect(await s.getItem("sb-auth")).toBe(big); // must reassemble exactly
    // head marker + 3 chunks stored under the cap
    expect(ss._store.get("sb-auth")).toMatch(/^__chunks__:\d+$/);
  });

  it("never throws even if the underlying store fails", async () => {
    const failing = {
      getItemAsync: async () => { throw new Error("keychain locked"); },
      setItemAsync: async () => { throw new Error("keychain locked"); },
      deleteItemAsync: async () => { throw new Error("keychain locked"); },
    };
    const s = createChunkedSecureStorage(failing);
    await expect(s.setItem("k", "x".repeat(5000))).resolves.toBeUndefined();
    await expect(s.getItem("k")).resolves.toBeNull(); // degrade to "no session"
    await expect(s.removeItem("k")).resolves.toBeUndefined();
  });

  it("switching from a large (chunked) value back to a small one clears old chunks", async () => {
    const ss = mockSecureStore();
    const s = createChunkedSecureStorage(ss);
    await s.setItem("sb-auth", "y".repeat(5000));
    await s.setItem("sb-auth", "tiny");
    expect(await s.getItem("sb-auth")).toBe("tiny");
    expect(ss._store.has("sb-auth.0")).toBe(false); // stale chunks gone
  });

  it("returns null (not a crash) when chunks are incomplete/corrupt", async () => {
    const ss = mockSecureStore();
    const s = createChunkedSecureStorage(ss);
    await s.setItem("sb-auth", "z".repeat(5000));
    ss._store.delete("sb-auth.1"); // simulate a truncated/corrupt write
    expect(await s.getItem("sb-auth")).toBeNull();
  });

  // The real-world bug: a prior build overflowed SecureStore and left a
  // truncated JSON session in the iOS Keychain (which persists across
  // reinstalls). supabase-js then crashed in _recoverAndRefresh. getItem must
  // purge such a value and report "no session".
  it("purges a corrupt/truncated JSON session and reports no session", async () => {
    const ss = mockSecureStore();
    ss._store.set("sb-x-auth-token", '{"access_token":"eyJhbGci","refresh_token'); // truncated
    const s = createChunkedSecureStorage(ss);
    expect(await s.getItem("sb-x-auth-token")).toBeNull();
    expect(ss._store.has("sb-x-auth-token")).toBe(false); // purged, can't resurface
  });

  it("passes through a valid JSON session untouched", async () => {
    const ss = mockSecureStore();
    const session = JSON.stringify({ access_token: "a", refresh_token: "b", user: { id: "x" } });
    ss._store.set("sb-x-auth-token", session);
    const s = createChunkedSecureStorage(ss);
    expect(await s.getItem("sb-x-auth-token")).toBe(session);
  });

  it("passes through a non-JSON value (PKCE code-verifier) untouched", async () => {
    const ss = mockSecureStore();
    ss._store.set("sb-x-auth-token-code-verifier", "plain-verifier-abc123");
    const s = createChunkedSecureStorage(ss);
    expect(await s.getItem("sb-x-auth-token-code-verifier")).toBe("plain-verifier-abc123");
  });
});
