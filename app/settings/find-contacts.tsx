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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useFeatureFlags } from "../../src/hooks/useFeatureFlags";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { Avatar } from "../../src/components/Avatar";
import { normalizePhone, hashPhone } from "../../src/utils/phoneHash";
import { mediumHaptic } from "../../src/utils/haptics";
import { logAnalyticsEvent } from "../../src/lib/analyticsLogger";

type ContactMatch = {
  user_id: string;
  username: string;
  avatar_url: string | null;
};

export default function FindContacts() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const contactsSyncEnabled = isEnabled("contacts_sync");

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [matches, setMatches] = useState<ContactMatch[] | null>(null);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  async function requestContactsPermission() {
    const { status } = await Contacts.requestPermissionsAsync();
    setPermissionGranted(status === "granted");

    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "To find friends from your contacts, please allow access in your device Settings."
      );
    }
  }

  async function syncContacts() {
    if (!user) return;

    setSyncing(true);
    logAnalyticsEvent(user.id, "contacts_sync_started");

    let resultCount = 0;

    try {
      // 1. Read contacts (phone numbers only)
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      if (!data || data.length === 0) {
        setMatches([]);
        return;
      }

      // 2. Extract and normalize phone numbers
      const rawPhones: string[] = [];
      for (const contact of data) {
        if (contact.phoneNumbers) {
          for (const pn of contact.phoneNumbers) {
            if (pn.number) {
              const normalized = normalizePhone(pn.number);
              if (normalized) rawPhones.push(normalized);
            }
          }
        }
      }

      // Dedupe
      const uniquePhones = [...new Set(rawPhones)];

      // Only log counts, never raw numbers
      console.log(
        `[Contacts] Found ${data.length} contacts, ${uniquePhones.length} valid numbers`
      );

      if (uniquePhones.length === 0) {
        setMatches([]);
        return;
      }

      // 3. Hash all numbers on-device
      const hashedPhones = await Promise.all(uniquePhones.map(hashPhone));

      // 4. Send hashes to server for matching
      const { data: matchData, error } = await (supabase.rpc as any)(
        "match_contacts",
        {
          p_user_id: user.id,
          p_hashed_phones: hashedPhones,
        }
      );

      if (error) {
        console.error("[Contacts] Match RPC error:", error.message);
        Alert.alert("Error", "Failed to match contacts. Please try again.");
        setMatches([]);
      } else {
        resultCount = (matchData || []).length;
        console.log(`[Contacts] ${resultCount} matches found`);
        setMatches(matchData || []);
      }
    } catch (err) {
      console.error("[Contacts] Sync error:", err);
      Alert.alert("Error", "Something went wrong. Please try again.");
      setMatches([]);
    } finally {
      logAnalyticsEvent(user.id, "contacts_sync_completed", {
        matchCount: resultCount,
      });
      setSyncing(false);
    }
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
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Find Friends from Contacts
        </Text>
      </View>

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
        ) : permissionGranted === null ? (
          /* Permission not yet requested */
          <Pressable
            onPress={requestContactsPermission}
            style={{
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 12,
              backgroundColor: Colors.primary,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.white }}>
              Allow Contacts Access
            </Text>
          </Pressable>
        ) : permissionGranted === false ? (
          /* Permission denied */
          <View style={{ gap: 12, alignItems: "center" }}>
            <Ionicons name="lock-closed-outline" size={40} color={colors.textTertiary} />
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
              Contacts access was denied. To enable it, go to your device Settings and allow contacts access for this app.
            </Text>
            <Pressable
              onPress={requestContactsPermission}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: Colors.primary,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary }}>
                Try Again
              </Text>
            </Pressable>
          </View>
        ) : syncing ? (
          /* Syncing in progress */
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 32 }}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>
              Matching contacts...
            </Text>
          </View>
        ) : matches === null ? (
          /* Permission granted, ready to sync */
          <Pressable
            onPress={syncContacts}
            style={{
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 12,
              backgroundColor: Colors.primary,
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.white }}>
              Find Friends
            </Text>
          </Pressable>
        ) : matches.length === 0 ? (
          /* No matches */
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 24 }}>
            <Ionicons name="people-outline" size={40} color={colors.textTertiary} />
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
              No matches found. Invite your friends to join!
            </Text>
            <Pressable
              onPress={syncContacts}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: Colors.primary,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.primary }}>
                Sync Again
              </Text>
            </Pressable>
          </View>
        ) : (
          /* Show matches */
          <View style={{ gap: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
              {matches.length} friend{matches.length !== 1 ? "s" : ""} found
            </Text>

            {matches.map((match) => {
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

            {/* Sync again link */}
            <Pressable onPress={syncContacts} style={{ paddingVertical: 8 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: Colors.primary,
                  textAlign: "center",
                }}
              >
                Sync again
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
