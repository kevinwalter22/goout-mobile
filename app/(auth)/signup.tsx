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

export default function SignUp() {
  const { signUp } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    if (!username || !email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (!ageConfirmed) {
      Alert.alert("Error", "You must confirm you are 13 or older to create an account");
      return;
    }

    if (username.length < 3 || username.length > 30) {
      Alert.alert("Error", "Username must be between 3 and 30 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      Alert.alert(
        "Error",
        "Username can only contain letters, numbers, and underscores",
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password, username);
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      Alert.alert(
        "Success",
        "Account created! Please check your email to verify your account.",
        [
          {
            text: "OK",
            onPress: () => router.replace("/(auth)/signin"),
          },
        ],
      );
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
          <Text style={{ fontSize: 16, opacity: 0.7 }}>Join the movement</Text>
        </View>

        <View style={{ gap: 12, marginTop: 24 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600" }}>Username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="yourname"
              autoCapitalize="none"
              autoComplete="username"
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                fontSize: 16,
              }}
            />
          </View>

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
              autoComplete="password-new"
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                fontSize: 16,
              }}
            />
          </View>

          <Pressable
            onPress={() => setAgeConfirmed((v) => !v)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              marginTop: 4,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: ageConfirmed ? "#000" : "#999",
                backgroundColor: ageConfirmed ? "#000" : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {ageConfirmed && (
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700", lineHeight: 16 }}>
                  ✓
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 14, color: "#333", flex: 1 }}>
              I confirm I am 13 years of age or older
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSignUp}
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
                Sign Up
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
            <Text style={{ opacity: 0.7 }}>Already have an account?</Text>
            <Link href="/(auth)/signin" asChild>
              <Pressable>
                <Text style={{ fontWeight: "600" }}>Sign In</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
