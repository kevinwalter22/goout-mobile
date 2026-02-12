import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { AuthProvider } from "../src/contexts/AuthContext";
import { ToastProvider } from "../src/context/ToastContext";
import { ThemeProvider, useTheme } from "../src/contexts/ThemeContext";
import { validateEnv } from "../src/config/env";
import { initSentry, SentryWrap } from "../src/lib/sentry";

// Initialize Sentry before any component renders
initSentry();

function ThemedStack() {
  const { colors, effectiveMode } = useTheme();

  return (
    <>
      <StatusBar style={effectiveMode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
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

function RootLayout() {
  const missingVars = validateEnv();

  if (missingVars.length > 0) {
    if (__DEV__) {
      return <EnvErrorScreen missing={missingVars} />;
    }
    console.error(`[Euda] Missing env vars: ${missingVars.join(", ")}`);
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ThemedStack />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default SentryWrap(RootLayout);
