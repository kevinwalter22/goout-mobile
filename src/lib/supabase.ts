import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "../types/database";
import { Env } from "../config/env";
import { devFetch } from "./devNetworkSim";
import { createChunkedSecureStorage } from "./chunkedSecureStorage";

const supabaseUrl = Env.SUPABASE_URL;
const supabaseAnonKey = Env.SUPABASE_ANON_KEY;

// Only import storage on client side (not during SSR)
let storage: any;

if (typeof window !== "undefined") {
  if (Platform.OS === "web") {
    // Use AsyncStorage for web
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require("@react-native-async-storage/async-storage")
      .default;
    storage = AsyncStorage;
  } else {
    // Use SecureStore for native — via a CHUNKED, crash-proof adapter. SecureStore
    // caps values at 2048 bytes; a Supabase session (~1.8KB) can cross that after
    // token rotation, and the old pass-through adapter then threw / truncated,
    // corrupting the stored session so the next launch's restore crashed the app
    // (native-only; web uses AsyncStorage). See src/lib/chunkedSecureStorage.ts.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const SecureStore = require("expo-secure-store");
    storage = createChunkedSecureStorage(SecureStore);
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: devFetch,
  },
});
