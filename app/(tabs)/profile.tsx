import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";

export default function Profile() {
  const { profile, loading, signOut } = useAuth();

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/(auth)/signin");
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  if (!profile) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <Text>No profile found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <View style={{ marginTop: 24, gap: 24 }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: "#e0e0e0",
            alignSelf: "center",
          }}
        />

        <View style={{ gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "700" }}>
            {profile.username}
          </Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            paddingVertical: 20,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: "#e0e0e0",
          }}
        >
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 20, fontWeight: "700" }}>
              {profile.xp}
            </Text>
            <Text style={{ fontSize: 14, opacity: 0.7 }}>XP</Text>
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 20, fontWeight: "700" }}>
              {profile.streak}
            </Text>
            <Text style={{ fontSize: 14, opacity: 0.7 }}>Streak</Text>
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 20, fontWeight: "700" }}>0</Text>
            <Text style={{ fontSize: 14, opacity: 0.7 }}>Friends</Text>
          </View>
        </View>

        <View style={{ gap: 12, marginTop: 8 }}>
          <Pressable
            onPress={handleSignOut}
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: "#000",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
              Sign Out
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
