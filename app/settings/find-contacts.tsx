import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { Avatar } from "../../src/components/Avatar";
import { useContactSync } from "../../src/hooks/useContactSync";
import { useFriendRecommendations } from "../../src/hooks/useFriendRecommendations";
import { mediumHaptic } from "../../src/utils/haptics";
import { supabase } from "../../src/lib/supabase";

export default function FindContacts() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const {
    syncing,
    lastSyncedAt,
    contactsSyncEnabled,
    syncNow,
    clearSuggestions,
  } = useContactSync();
  const { recommendations, refresh: refreshRecs } = useFriendRecommendations(20);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  // Filter to contact-source suggestions only
  const contactMatches = recommendations.filter((r) => r.source === "contact");

  async function handleSync() {
    const ok = await syncNow();
    if (ok) refreshRecs();
  }

  async function handleClearSuggestions() {
    Alert.alert(
      "Remove Contact Matches",
      "This will remove all contact-based friend suggestions. You can re-sync at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await clearSuggestions();
            refreshRecs();
          },
        },
      ],
    );
  }

  async function sendFriendRequest(targetUserId: string) {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("friendships")
        .insert({ user_id: user.id, friend_id: targetUserId, status: "pending" } as any);

      if (error) {
        console.error("[Contacts] Friend request error:", error.message);
        return;
      }

      mediumHaptic();
      setSentRequests((prev) => new Set(prev).add(targetUserId));
    } catch (err) {
      console.error("[Contacts] Friend request error:", err);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Find Friends from Contacts" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 24, gap: 24 }}
      >
        {/* Privacy Banner */}
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            padding: 16,
            borderRadius: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={24} color={Colors.primary} />
          <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
            We only upload hashed phone numbers to find friends. Your contacts are never stored on our servers.
          </Text>
        </View>

        {/* Kill switch: contacts sync disabled */}
        {!contactsSyncEnabled ? (
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
            <Ionicons name="pause-circle-outline" size={40} color={colors.textTertiary} />
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
              Contact sync is temporarily unavailable. Please try again later.
            </Text>
          </View>
        ) : Platform.OS === "web" ? (
          <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
            Contact sync is only available on mobile devices.
          </Text>
        ) : syncing ? (
          /* Syncing in progress */
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>
              Matching contacts...
            </Text>
          </View>
        ) : (
          <View style={{ gap: 20 }}>
            {/* Sync button */}
            <Pressable
              onPress={handleSync}
              accessibilityLabel={lastSyncedAt ? "Sync contacts again" : "Find friends from contacts"}
              accessibilityRole="button"
              style={{
                paddingVertical: 14,
                paddingHorizontal: 24,
                borderRadius: 12,
                backgroundColor: Colors.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.white }}>
                {lastSyncedAt ? "Sync Again" : "Find Friends"}
              </Text>
            </Pressable>

            {/* Last synced timestamp */}
            {lastSyncedAt && (
              <Text style={{ fontSize: 13, color: colors.textTertiary, textAlign: "center" }}>
                Last synced: {lastSyncedAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            )}

            {/* Contact match results */}
            {contactMatches.length > 0 ? (
              <View style={{ gap: 16 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                  {contactMatches.length} friend{contactMatches.length !== 1 ? "s" : ""} found from contacts
                </Text>

                {contactMatches.map((match) => {
                  const alreadySent = sentRequests.has(match.user_id);

                  return (
                    <View
                      key={match.user_id}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                    >
                      <Avatar avatarUrl={match.avatar_url} size={40} />
                      <Text
                        style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.text }}
                      >
                        {match.username}
                      </Text>
                      <Pressable
                        onPress={() => sendFriendRequest(match.user_id)}
                        disabled={alreadySent}
                        accessibilityLabel={alreadySent ? `Request sent to ${match.username}` : `Add ${match.username}`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: alreadySent }}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 14,
                          borderRadius: 16,
                          backgroundColor: alreadySent ? colors.border : Colors.primary,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: "600",
                            color: alreadySent ? colors.textSecondary : Colors.white,
                          }}
                        >
                          {alreadySent ? "Sent" : "Add"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : lastSyncedAt ? (
              <View style={{ alignItems: "center", gap: 12, paddingVertical: 12 }}>
                <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
                <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
                  No matches found. Invite your friends to join!
                </Text>
              </View>
            ) : null}

            {/* Privacy controls — only shown after at least one sync */}
            {lastSyncedAt && (
              <View style={{ gap: 12, marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.separator }}>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: colors.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Privacy
                </Text>

                <Pressable
                  onPress={handleClearSuggestions}
                  accessibilityLabel="Remove contact matches"
                  accessibilityRole="button"
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 10,
                    backgroundColor: Colors.error + "12",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.error }}>
                    Remove Contact Matches
                  </Text>
                </Pressable>

                <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: "center", lineHeight: 16 }}>
                  This removes all stored friend suggestions from contacts. No raw contact data is ever stored — only anonymous match results.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
