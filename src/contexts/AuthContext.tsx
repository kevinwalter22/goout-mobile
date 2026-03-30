import { createContext, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { clearExpiredUrlCache } from "../utils/storage";
import { setSentryUser } from "../lib/sentry";
import { logAnalyticsEvent } from "../lib/analyticsLogger";
import { captureError } from "../lib/logger";
import { setLocationOverride } from "../utils/location";
import type { Profile } from "../types/database";

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    username: string,
  ) => Promise<{ error: Error | null }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  signUp: async () => ({ error: null }),
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLocationOverride(session?.user?.email ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setSentryUser(session?.user?.id ?? null);
      setLocationOverride(session?.user?.email ?? null);

      if (event === "SIGNED_OUT") {
        setProfile(null);
        setLoading(false);
        return;
      }

      // Only reload profile on sign-in or user update, not on every token refresh
      if (
        session?.user &&
        (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION")
      ) {
        loadProfile(session.user.id);
      } else if (!session?.user) {
        setProfile(null);
        setLoading(false);
      }
    });

    // Revalidate session when app returns to foreground
    const appStateSub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        supabase.auth.getSession();
      }
      appState.current = nextState;
    });

    return () => {
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  async function loadProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data as any);
    } catch (error) {
      captureError(error, { action: "loadProfile" });
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email: string, password: string, username: string) {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
          emailRedirectTo: "https://links.euda.live/auth/callback",
        },
      });

      if (error) throw error;

      // Fire-and-forget: log signup event once we have a user ID
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user?.id) {
        logAnalyticsEvent(sessionData.session.user.id, "signup_complete");
      }

      return { error: null };
    } catch (error) {
      // Surface unexpected auth failures to Sentry — expected user errors
      // (already registered, rate limit) are not bugs; everything else is.
      const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
      const isExpectedUserError = [
        "user already registered",
        "email rate limit exceeded",
        "password should be at least",
        "for security purposes",
        "over email send rate limit",
      ].some((k) => msg.includes(k));
      if (!isExpectedUserError) {
        captureError(error, { action: "signUp" });
      }
      return { error: error as Error };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    // Clear cached URLs on logout to prevent stale data
    clearExpiredUrlCache();
    // scope: 'global' revokes the refresh token server-side and
    // invalidates all sessions for this user across all devices.
    await supabase.auth.signOut({ scope: "global" });
  }

  async function refreshProfile() {
    if (user) {
      await loadProfile(user.id);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
