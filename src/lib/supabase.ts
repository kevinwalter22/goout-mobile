import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "../types/database";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Only import storage on client side (not during SSR)
let storage: any;

if (typeof window !== "undefined") {
  if (Platform.OS === "web") {
    // Use AsyncStorage for web
    const AsyncStorage = require("@react-native-async-storage/async-storage")
      .default;
    storage = AsyncStorage;
  } else {
    // Use SecureStore for native
    const SecureStore = require("expo-secure-store");
    storage = {
      getItem: (key: string) => {
        return SecureStore.getItemAsync(key);
      },
      setItem: (key: string, value: string) => {
        return SecureStore.setItemAsync(key, value);
      },
      removeItem: (key: string) => {
        return SecureStore.deleteItemAsync(key);
      },
    };
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
