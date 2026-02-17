import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../../src/lib/supabase";
import { Colors } from "../../src/config/theme";

/**
 * Auth callback screen — handles Supabase email verification redirects.
 *
 * Supabase redirects the user here after clicking the email verification link.
 * Depending on the flow, the tokens arrive either as:
 *   1. Hash fragment: ...#access_token=...&refresh_token=...&type=signup
 *   2. Query param (PKCE): ...?code=...
 *
 * This screen extracts the tokens, establishes the session, then navigates
 * to the sign-in screen (verified) or the main feed (auto-signed-in).
 */
export default function AuthCallback() {
  const params = useLocalSearchParams();

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    try {
      // Try PKCE code exchange first (query param)
      const code = params.code as string | undefined;
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          router.replace("/(tabs)/feed");
          return;
        }
      }

      // Fallback: extract tokens from the full URL (hash fragment)
      const url = await Linking.getInitialURL();
      if (url) {
        const hash = url.split("#")[1];
        if (hash) {
          const hashParams = new URLSearchParams(hash);
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              router.replace("/(tabs)/feed");
              return;
            }
          }
        }
      }

      // If we got here, no tokens were found — redirect to sign-in
      router.replace("/(auth)/signin");
    } catch {
      router.replace("/(auth)/signin");
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
