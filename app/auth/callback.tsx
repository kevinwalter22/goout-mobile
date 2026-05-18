import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../../src/lib/supabase";
import { logAuthEvent } from "../../src/lib/authLog";
import { Colors } from "../../src/config/theme";

/**
 * Auth callback screen — handles Supabase email verification and password reset redirects.
 *
 * Supabase redirects the user here after clicking the email verification link
 * OR a password reset link. Tokens arrive either as:
 *   1. Hash fragment: ...#access_token=...&refresh_token=...&type=signup|recovery
 *   2. Query param (PKCE): ...?code=...&type=signup|recovery
 *
 * type=recovery → routes to the reset-password screen.
 * All other types → routes to the main feed (auto-signed-in).
 */
export default function AuthCallback() {
  const params = useLocalSearchParams();

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    const callbackType = (params.type as string | undefined) ?? "unknown";
    try {
      // Try PKCE code exchange first (query param)
      const code = params.code as string | undefined;
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          logAuthEvent("confirmation_arrived", {
            userId: data?.user?.id ?? null,
            email: data?.user?.email ?? null,
            metadata: { callback_type: callbackType, flow: "pkce" },
          });
          router.replace((callbackType === "recovery" ? "/(auth)/reset-password" : "/(tabs)/feed") as any);
          return;
        }
        logAuthEvent("confirmation_failed", {
          errorCode: "pkce_exchange_failed",
          errorMessage: error.message,
          metadata: { callback_type: callbackType, flow: "pkce" },
        });
      }

      // Fallback: extract tokens from the full URL (hash fragment)
      const url = await Linking.getInitialURL();
      if (url) {
        const hash = url.split("#")[1];
        if (hash) {
          const hashParams = new URLSearchParams(hash);
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          const type = hashParams.get("type") ?? callbackType;

          if (accessToken && refreshToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              logAuthEvent("confirmation_arrived", {
                userId: data?.user?.id ?? null,
                email: data?.user?.email ?? null,
                metadata: { callback_type: type, flow: "hash_fragment" },
              });
              router.replace((type === "recovery" ? "/(auth)/reset-password" : "/(tabs)/feed") as any);
              return;
            }
            logAuthEvent("confirmation_failed", {
              errorCode: "set_session_failed",
              errorMessage: error.message,
              metadata: { callback_type: type, flow: "hash_fragment" },
            });
          }
        }
      }

      // If we got here, no tokens were found — redirect to sign-in
      logAuthEvent("confirmation_failed", {
        errorCode: "no_tokens_found",
        errorMessage: "Callback opened without code or hash tokens",
        metadata: { callback_type: callbackType },
      });
      router.replace("/(auth)/signin");
    } catch (err) {
      logAuthEvent("confirmation_failed", {
        errorCode: "exception",
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: { callback_type: callbackType },
      });
      router.replace("/(auth)/signin");
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
