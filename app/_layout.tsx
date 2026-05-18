import { Component, useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "../src/contexts/AuthContext";
import { useAuth } from "../src/hooks/useAuth";
import { ToastProvider } from "../src/context/ToastContext";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { validateEnv } from "../src/config/env";
import { initSentry, SentryWrap } from "../src/lib/sentry";
import { captureWarning } from "../src/lib/logger";
import { SwipeableBackGesture } from "../src/components/SwipeableBackGesture";
import {
  registerForPushNotifications,
  removePushToken,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  handleNotificationResponse,
  handleNotificationReceivedForeground,
  getPushPermissionStatus,
} from "../src/lib/notifications";
import {
  getSimMode,
  subscribeSimMode,
  simModeDisplay,
  type SimMode,
} from "../src/lib/devNetworkSim";

// Initialize Sentry before any component renders
initSentry();

function ThemedStack() {
  const { colors, effectiveMode } = useTheme();

  return (
    <>
      <StatusBar style={effectiveMode === "dark" ? "light" : "dark"} />
      <SwipeableBackGesture>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            gestureEnabled: true,
            gestureDirection: "horizontal",
            // Native edge gesture kept as a fallback (20px left strip).
            // SwipeableBackGesture adds mid-screen horizontal back-swipe
            // on detail screens using the same RNGH failOffsetY pattern
            // as SwipeableTabsContainer.
            fullScreenGestureEnabled: false,
            gestureResponseDistance: 20 as any,
          }}
        >
          {/* Authenticated tab root — SwipeableTabsContainer handles all
              horizontal navigation within tabs. Both the native back gesture
              and SwipeableBackGesture are disabled here to prevent
              back-swiping to auth screens. */}
          <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        </Stack>
      </SwipeableBackGesture>
    </>
  );
}

function EnvErrorScreen({ missing }: { missing: string[] }) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        backgroundColor: "#fff",
      }}
    >
      <View
        style={{
          borderWidth: 2,
          borderColor: "#e53e3e",
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: "100%",
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#e53e3e" }}>
          Missing Environment Variables
        </Text>
        <Text style={{ fontSize: 14, color: "#333" }}>
          The following required variables are not set:
        </Text>
        {missing.map((v) => (
          <Text key={v} style={{ fontSize: 14, fontFamily: "monospace", color: "#e53e3e" }}>
            {v}
          </Text>
        ))}
        <Text style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
          Copy .env.example to .env and fill in your Supabase credentials.{"\n"}
          See docs/ENVIRONMENTS.md for details.
        </Text>
      </View>
    </View>
  );
}

function DevSimBanner() {
  const [mode, setMode] = useState<SimMode>(getSimMode());

  useEffect(() => {
    return subscribeSimMode(setMode);
  }, []);

  const display = simModeDisplay(mode);
  if (!display) return null;

  return (
    <View
      style={{
        backgroundColor: display.color,
        paddingVertical: 4,
        paddingHorizontal: 12,
        alignItems: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>
        {display.label}
      </Text>
    </View>
  );
}

async function initPushNotifications(userId: string) {
  if (Platform.OS === "web") return;

  const status = await getPushPermissionStatus();

  if (status === "undetermined") {
    // Soft-ask: show in-app explanation before the OS permission dialog fires.
    // Users who understand the value are far more likely to tap "Allow".
    Alert.alert(
      "Stay in the Loop",
      "Get notified when friends are going to events nearby or when you receive a friend request.",
      [
        { text: "Not Now", style: "cancel" },
        {
          text: "Enable Notifications",
          onPress: () => registerForPushNotifications(userId),
        },
      ],
    );
  } else {
    // Permission already determined — register directly (no OS prompt will re-fire).
    registerForPushNotifications(userId);
  }
}

function NotificationInitializer() {
  const { user } = useAuth();
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    if (user) {
      prevUserId.current = user.id;
      // Delay the notification soft-ask so it doesn't collide with the iOS
      // location permission dialog that fires from Explore on first launch.
      // Stacking two prompts immediately after login feels like a bug to users.
      const t = setTimeout(() => initPushNotifications(user.id), 1500);
      return () => clearTimeout(t);
    } else if (prevUserId.current) {
      // User signed out — remove token
      removePushToken(prevUserId.current);
      prevUserId.current = null;
    }
  }, [user]);

  useEffect(() => {
    // Handle notification taps (deep-link to relevant screen)
    const unsubTap = addNotificationResponseListener(handleNotificationResponse);
    // Handle foreground arrivals (emit data-refresh events so badges update
    // while the user stays on the current screen)
    const unsubForeground = addNotificationReceivedListener(handleNotificationReceivedForeground);
    return () => {
      unsubTap?.();
      unsubForeground?.();
    };
  }, []);

  return null;
}

function FallbackScreen({ onRetry }: { onRetry?: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 32,
        backgroundColor: "#fff",
        gap: 16,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor: "#7C3AED",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 32 }}>E</Text>
      </View>
      <Text style={{ fontSize: 22, fontWeight: "700", color: "#111", textAlign: "center" }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 15, color: "#666", textAlign: "center", lineHeight: 22 }}>
        Euda ran into an unexpected error. Your data is safe — tap below to try again.
      </Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityLabel="Try again"
          accessibilityRole="button"
          style={{
            marginTop: 8,
            paddingHorizontal: 32,
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: "#7C3AED",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>Try Again</Text>
        </Pressable>
      )}
    </View>
  );
}

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <FallbackScreen onRetry={() => this.setState({ hasError: false })} />
      );
    }
    return this.props.children;
  }
}

function RootLayout() {
  const missingVars = validateEnv();

  if (missingVars.length > 0) {
    if (__DEV__) {
      return <EnvErrorScreen missing={missingVars} />;
    }
    captureWarning("Missing env vars at startup", { count: missingVars.length });
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <NotificationInitializer />
          {__DEV__ && <DevSimBanner />}
          <ThemedStack />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const WrappedRootLayout = SentryWrap(RootLayout);

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppErrorBoundary>
        <WrappedRootLayout />
      </AppErrorBoundary>
    </GestureHandlerRootView>
  );
}
