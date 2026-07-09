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
});
