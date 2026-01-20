import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { useFriendsList } from "../../src/hooks/useFriendsList";
import { UserSearchSheet } from "../../src/components/UserSearchSheet";
import { FriendsSheet } from "../../src/components/FriendsSheet";

export default function Profile() {
  const { profile, loading, signOut } = useAuth();
  const { friends } = useFriendsList();
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showFriends, setShowFriends] = useState(false);

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
    <View style={{ flex: 1, padding: 24, paddingTop: 60 }}>
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
            <Text style={{ fontSize: 20, fontWeight: "700" }}>
              {friends.length}
            </Text>
            <Text style={{ fontSize: 14, opacity: 0.7 }}>Friends</Text>
          </View>
        </View>

        {/* Friend Management Buttons */}
        <View style={{ gap: 12, marginTop: 16 }}>
          <Pressable
            onPress={() => setShowUserSearch(true)}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 20,
              backgroundColor: "#007AFF",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#fff" }}>
              Add Friends
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setShowFriends(true)}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 20,
              backgroundColor: "#f5f5f5",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#000" }}>
              View Friends
            </Text>
          </Pressable>
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

      {/* Modals */}
      <UserSearchSheet
        visible={showUserSearch}
        onClose={() => setShowUserSearch(false)}
      />
      <FriendsSheet
        visible={showFriends}
        onClose={() => setShowFriends(false)}
      />
    </View>
  );
}
