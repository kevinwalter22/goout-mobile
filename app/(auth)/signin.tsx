import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      router.replace("/(tabs)/feed");
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
          gap: 16,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 32, fontWeight: "700" }}>euda</Text>
          <Text style={{ fontSize: 16, opacity: 0.7 }}>
            Presence &gt; content
          </Text>
        </View>

        <View style={{ gap: 12, marginTop: 24 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600" }}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                fontSize: 16,
              }}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600" }}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                fontSize: 16,
              }}
            />
          </View>

          <Pressable
            onPress={handleSignIn}
            disabled={loading}
            style={{
              marginTop: 8,
              padding: 16,
              borderRadius: 12,
              backgroundColor: "#000",
              alignItems: "center",
            }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                Sign In
              </Text>
            )}
          </Pressable>

          <View
            style={{
              marginTop: 16,
              flexDirection: "row",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Text style={{ opacity: 0.7 }}>Don't have an account?</Text>
            <Link href="/(auth)/signup" asChild>
              <Pressable>
                <Text style={{ fontWeight: "600" }}>Sign Up</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
