/**
 * Chunked, crash-proof SecureStore adapter for the Supabase session.
 *
 * SecureStore rejects values larger than 2048 bytes. A Supabase session
 * (access token + refresh token + user JSON) runs ~1.8KB and can cross 2048
 * after token rotation. Passing an over-limit value straight to SecureStore
 * either throws or silently truncates — corrupting the stored session so the
 * NEXT launch's restore/refresh throws and crashes the app (native-only; web
 * uses AsyncStorage, which has no such limit — which is why this never
 * reproduced on web).
 *
 * This adapter splits large values across `${key}.N` chunks and NEVER throws:
 * any storage failure degrades to "no session" → the login screen, never a
 * crash.
 */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AsyncStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MARKER = "__chunks__:";

export function createChunkedSecureStorage(
  SecureStore: SecureStoreLike,
  chunkSize = 1800, // stay well under the 2048-byte SecureStore cap
): AsyncStorageAdapter {
  const clearChunks = async (key: string) => {
    try {
      const head = await SecureStore.getItemAsync(key);
      if (head && head.startsWith(MARKER)) {
        const n = parseInt(head.slice(MARKER.length), 10) || 0;
        for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
    } catch {
      /* ignore */
    }
  };

  return {
    getItem: async (key: string): Promise<string | null> => {
      try {
        const head = await SecureStore.getItemAsync(key);
        if (head == null) return null;
        let value: string;
        if (!head.startsWith(MARKER)) {
          value = head; // small / legacy inline value
        } else {
          const n = parseInt(head.slice(MARKER.length), 10) || 0;
          let out = "";
          for (let i = 0; i < n; i++) {
            const part = await SecureStore.getItemAsync(`${key}.${i}`);
            if (part == null) {
              // Incomplete chunk set → corrupt. Clear it and report no session
              // so supabase-js starts clean instead of choking on a partial read.
              await clearChunks(key);
              await SecureStore.deleteItemAsync(key);
              return null;
            }
            out += part;
          }
          value = out;
        }
        // A persisted Supabase session is a JSON object. A value that starts
        // like one but won't parse is a corrupt/truncated leftover — e.g. from
        // the OLD adapter overflowing SecureStore's 2048-byte cap, which then
        // crashed supabase-js in _recoverAndRefresh on the next launch (the
        // real cause of the intermittent "Something went wrong" login). Purge it
        // and report "no session" so the next login starts clean. (Non-JSON
        // values like the PKCE code-verifier are passed through untouched.)
        if (value.length > 0 && value[0] === "{") {
          try {
            JSON.parse(value);
          } catch {
            await clearChunks(key);
            await SecureStore.deleteItemAsync(key);
            return null;
          }
        }
        return value;
      } catch {
        return null; // corrupt / unreadable → drop to login, don't crash
      }
    },

    setItem: async (key: string, value: string): Promise<void> => {
      try {
        await clearChunks(key);
        if (value.length <= chunkSize) {
          await SecureStore.setItemAsync(key, value);
          return;
        }
        const n = Math.ceil(value.length / chunkSize);
        for (let i = 0; i < n; i++) {
          await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * chunkSize, (i + 1) * chunkSize));
        }
        await SecureStore.setItemAsync(key, `${MARKER}${n}`);
      } catch {
        /* non-fatal: session simply won't persist this cycle */
      }
    },

    removeItem: async (key: string): Promise<void> => {
      try {
        await clearChunks(key);
        await SecureStore.deleteItemAsync(key);
      } catch {
        /* ignore */
      }
    },
  };
}
