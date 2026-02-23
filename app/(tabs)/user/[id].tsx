import { useState, useEffect, useRef } from "react";
import { useLocalSearchParams, router } from "expo-router";
import {
  View,
  Text,
  Alert,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Image,
} from "react-native";
import { useProfile } from "../../../src/hooks/useProfile";
import { useUserPosts } from "../../../src/hooks/useUserPosts";
import { useFriendCount } from "../../../src/hooks/useFriendCount";
import { useFriendship } from "../../../src/hooks/useFriendship";
import { useBlockUser } from "../../../src/hooks/useBlockUser";
import { Avatar } from "../../../src/components/Avatar";
import { PostImage } from "../../../src/components/PostImage";
import { ViewFriendsSheet } from "../../../src/components/ViewFriendsSheet";
import { ContentActionMenu } from "../../../src/components/ContentActionMenu";
import { ReportSheet } from "../../../src/components/ReportSheet";
import { useAuth } from "../../../src/hooks/useAuth";
import { useUpcomingPlans } from "../../../src/hooks/useUpcomingPlans";
import { Colors } from "../../../src/config/theme";
import { useTheme } from "../../../src/contexts/ThemeContext";
import { getEffectiveStreak } from "../../../src/utils/streak";

export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { profile, loading, error, refresh: refreshProfile } = useProfile(id);
  const { posts, loading: postsLoading } = useUserPosts(id);
  const { plans, loading: plansLoading } = useUpcomingPlans(id);
  const { count: friendCount, increment: incrementFriendCount } = useFriendCount(id);
  const {
    status,
    loading: friendshipLoading,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useFriendship(id);

  const [showFriendsSheet, setShowFriendsSheet] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { blockUser } = useBlockUser();

  const isOwnProfile = user?.id === id;
  const isFriends = status === "accepted";
  const canSeeContent = isOwnProfile || isFriends;

  // Auto-refresh profile + friend count when friendship is accepted
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== "accepted" && status === "accepted") {
      refreshProfile();
      incrementFriendCount();
    }
    prevStatusRef.current = status;
  }, [status]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: colors.background }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>Profile not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.text,
          }}
        >
          <Text style={{ color: colors.background, fontWeight: "600" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={{ flex: 1 }}>
      {/* Back button + action menu */}
      <View style={{ padding: 16, paddingTop: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ fontSize: 16, color: Colors.primary }}>← Back</Text>
        </Pressable>
        {!isOwnProfile && id && (
          <ContentActionMenu
            authorUserId={id}
            targetType="user"
            targetId={id}
            onReport={() => setShowReport(true)}
            onBlockUser={async () => {
              const ok = await blockUser(id);
              if (ok) {
                Alert.alert("User Blocked", "Their content will be hidden from your feed.", [
                  { text: "OK", onPress: () => router.back() },
                ]);
              } else {
                Alert.alert("Error", "Failed to block user. Please try again.");
              }
            }}
            size={22}
          />
        )}
      </View>

      {/* Profile header */}
      <View style={{ padding: 24, gap: 24 }}>
        <Avatar avatarUrl={profile.avatar_url} size={80} style={{ alignSelf: "center" }} />

        <View style={{ gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>{profile.username}</Text>
          {profile.bio && (
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
              {profile.bio}
            </Text>
          )}
        </View>

        {/* Stats */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            paddingVertical: 20,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: colors.separator,
          }}
        >
          <View style={{ alignItems: "center", gap: 4, flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{profile.xp}</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>XP</Text>
          </View>
          <View style={{ alignItems: "center", gap: 4, flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
              {getEffectiveStreak(profile.last_post_date, profile.streak)}
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>Streak</Text>
          </View>
          <Pressable
            style={{ alignItems: "center", gap: 4, flex: 1 }}
            onPress={() => isFriends && setShowFriendsSheet(true)}
            disabled={!isFriends}
          >
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{friendCount}</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>Friends</Text>
          </Pressable>
        </View>

        {/* Friend action buttons (only if not own profile) */}
        {!isOwnProfile && (
          <>
            {status === "pending_received" ? (
              // Show Accept and Decline buttons for received friend requests
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Pressable
                  onPress={declineFriendRequest}
                  disabled={friendshipLoading}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 20,
                    backgroundColor: colors.surfaceVariant,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: colors.text,
                    }}
                  >
                    {friendshipLoading ? "..." : "Decline"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={acceptFriendRequest}
                  disabled={friendshipLoading}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 20,
                    backgroundColor: Colors.primary,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: Colors.white,
                    }}
                  >
                    {friendshipLoading ? "..." : "Accept"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              // Show single button for other states
              <Pressable
                onPress={() => {
                  if (status === "none") sendFriendRequest();
                  else if (status === "pending_sent") cancelFriendRequest();
                  else if (status === "accepted") removeFriend();
                }}
                disabled={friendshipLoading}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 20,
                  backgroundColor:
                    status === "accepted" || status === "pending_sent"
                      ? colors.surfaceVariant
                      : Colors.primary,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color:
                      status === "accepted" || status === "pending_sent"
                        ? colors.text
                        : Colors.white,
                  }}
                >
                  {friendshipLoading
                    ? "..."
                    : status === "none"
                    ? "Add Friend"
                    : status === "pending_sent"
                    ? "Request Sent"
                    : "Friends"}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* Restricted profile message for non-friends */}
      {!canSeeContent && (
        <View style={{ padding: 24, alignItems: "center" }}>
          <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
            Add {profile.username} as a friend to see their posts and plans.
          </Text>
        </View>
      )}

      {/* Upcoming Plans — friends and own profile only */}
      {canSeeContent && !plansLoading && plans.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 12, color: colors.text }}>
            Upcoming
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -16 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {plans.map((plan) => (
              <Pressable
                key={plan.id}
                onPress={() => router.push(`/event/${plan.id}` as any)}
                style={{
                  width: 200,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.cardBg,
                  overflow: "hidden",
                }}
              >
                {plan.image_thumb_url ? (
                  <Image
                    source={{ uri: plan.image_thumb_url }}
                    style={{ width: "100%", height: 80, backgroundColor: colors.surfaceVariant }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ width: "100%", height: 40, backgroundColor: colors.surfaceVariant }} />
                )}
                <View style={{ padding: 10, gap: 2 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }} numberOfLines={1}>
                    {plan.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>
                    {plan.starts_at
                      ? new Date(plan.starts_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Ongoing"}
                  </Text>
                  {(plan.location_name || plan.town) && (
                    <Text style={{ fontSize: 12, color: colors.textTertiary }} numberOfLines={1}>
                      {[plan.location_name, plan.town].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Posts grid — friends and own profile only */}
      {canSeeContent && (
        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: colors.text }}>
            Posts ({posts.length})
          </Text>

          {postsLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : posts.length === 0 ? (
            <Text style={{ textAlign: "center", color: colors.textSecondary, paddingVertical: 32 }}>
              No posts yet
            </Text>
          ) : (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {posts.map((post) => (
                <Pressable
                  key={post.id}
                  onPress={() => router.push(`/post/${post.id}` as any)}
                  style={{
                    width: "31%",
                    aspectRatio: 1,
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <PostImage
                    photoPath={post.photo_path}
                    style={{ width: "100%", height: "100%" }}
                  />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
      </ScrollView>

      {/* Friends Sheet - only accessible if friends with user */}
      {isFriends && profile && (
        <ViewFriendsSheet
          visible={showFriendsSheet}
          onClose={() => setShowFriendsSheet(false)}
          userId={id!}
          username={profile.username}
          onFriendTap={(friendId) => {
            setShowFriendsSheet(false);
            // Navigate to the friend's profile
            if (friendId === user?.id) {
              // If tapping own profile, go to profile tab
              router.push("/(tabs)/profile" as any);
            } else {
              router.push(`/user/${friendId}` as any);
            }
          }}
        />
      )}

      {/* Report Sheet */}
      {!isOwnProfile && id && (
        <ReportSheet
          visible={showReport}
          onClose={() => setShowReport(false)}
          targetType="user"
          targetId={id}
          onBlockUser={async (userId) => {
            const ok = await blockUser(userId);
            if (ok) {
              Alert.alert("User Blocked", "Their content will be hidden from your feed.", [
                { text: "OK", onPress: () => router.back() },
              ]);
            }
            setShowReport(false);
          }}
        />
      )}
    </View>
  );
}
