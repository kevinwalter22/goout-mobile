import { useState, useRef, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
  ScrollView,
  TextInput,
  Modal,
  Image,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../src/hooks/useAuth";
import { useFriendsList } from "../../src/hooks/useFriendsList";
import { useUserPosts } from "../../src/hooks/useUserPosts";
import { UserSearchSheet } from "../../src/components/UserSearchSheet";
import { FriendsSheet } from "../../src/components/FriendsSheet";
import { FriendRequestsSheet } from "../../src/components/FriendRequestsSheet";
import { Avatar } from "../../src/components/Avatar";
import { useFriendRequests } from "../../src/hooks/useFriendRequests";
import { PostImage } from "../../src/components/PostImage";
import { pickAndUploadAvatar } from "../../src/utils/avatar";
import { deleteImage } from "../../src/utils/storage";
import { requestImageModeration } from "../../src/utils/imageModeration";
import { supabase } from "../../src/lib/supabase";
import { useToast } from "../../src/context/ToastContext";
import { useFocusEffect } from "expo-router";
import { scrollToTopEmitter } from "../../src/utils/scrollToTop";
import { useUpcomingPlans } from "../../src/hooks/useUpcomingPlans";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { getEffectiveStreak } from "../../src/utils/streak";
import { useFriendRecommendations } from "../../src/hooks/useFriendRecommendations";
import { useContactSync } from "../../src/hooks/useContactSync";

export default function Profile() {
  const { profile, loading, signOut, user, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const { friends, refresh: refreshFriends } = useFriendsList();
  const { requests, refresh: refreshRequests, removeRequest } = useFriendRequests();
  const { recommendations, loading: recsLoading, sendRequest, refresh: refreshRecs } = useFriendRecommendations(5);
  const { syncing: contactSyncing, needsSync, lastSyncedAt, contactsSyncEnabled, syncNow } = useContactSync();
  const { posts, loading: postsLoading, removePost, refresh: refreshPosts } = useUserPosts(user?.id || null);
  const { plans, loading: plansLoading, refresh: refreshPlans } = useUpcomingPlans(user?.id);
  const { showToast } = useToast();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const GRID_GAP = 8;
  const GRID_PADDING = 24;
  const postSize = Math.floor((screenWidth - GRID_PADDING * 2 - GRID_GAP * 2) / 3);
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showFriendRequests, setShowFriendRequests] = useState(false);
  const [showBioEdit, setShowBioEdit] = useState(false);
  const [dismissedSyncCard, setDismissedSyncCard] = useState(false);
  const [bio, setBio] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Silently refresh data when screen regains focus (e.g. after deleting post or accepting friend)
  useFocusEffect(
    useCallback(() => {
      refreshPosts();
      refreshFriends();
      refreshRequests();
      refreshRecs();
      refreshPlans();
    }, [])
  );

  // Auto-sync contacts in background when stale (>7 days) and already synced before
  useFocusEffect(
    useCallback(() => {
      if (lastSyncedAt && needsSync && contactsSyncEnabled) {
        syncNow().then(() => refreshRecs());
      }
    }, [lastSyncedAt, needsSync, contactsSyncEnabled])
  );

  // Listen for scroll-to-top events
  useEffect(() => {
    const handleScrollToTop = () => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    };

    scrollToTopEmitter.on("scrollToTop:profile", handleScrollToTop);

    return () => {
      scrollToTopEmitter.off("scrollToTop:profile", handleScrollToTop);
    };
  }, []);

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

  async function handleAvatarUpload() {
    if (!user) return;

    setUploadingAvatar(true);

    try {
      const { avatarUrl, error } = await pickAndUploadAvatar(user.id);

      if (error) {
        if (error !== "Cancelled") {
          showToast(error, "error");
        }
        return;
      }

      if (!avatarUrl) return;

      // Update profile in database
      const { error: updateError } = await (supabase
        .from("profiles")
        .update as any)({ avatar_url: avatarUrl })
        .eq("id", user.id);

      if (updateError) {
        showToast("Failed to update avatar", "error");
        return;
      }

      showToast("Avatar updated!", "success");
      // Fire-and-forget image moderation
      requestImageModeration({ bucket: "avatars", path: `${user.id}/avatar.jpg` });
      // Refresh profile to show updated avatar
      await refreshProfile();
    } catch (error) {
      console.error("Avatar upload error:", error);
      showToast("Failed to upload avatar", "error");
    } finally {
      setUploadingAvatar(false);
    }
  }

  function handleEditBio() {
    setBio(profile?.bio || "");
    setShowBioEdit(true);
  }

  async function handleSaveBio() {
    if (!user) return;

    setSavingBio(true);

    try {
      const { error } = await (supabase
        .from("profiles")
        .update as any)({ bio: bio.trim() || null })
        .eq("id", user.id);

      if (error) {
        showToast("Failed to save bio", "error");
        return;
      }

      showToast("Bio updated!", "success");
      setShowBioEdit(false);
      // Refresh profile to show updated bio
      await refreshProfile();
    } catch (error) {
      console.error("Bio save error:", error);
      showToast("Failed to save bio", "error");
    } finally {
      setSavingBio(false);
    }
  }

  function handleFriendTap(friendId: string) {
    setShowFriends(false);
    router.push(`/user/${friendId}` as any);
  }

  function handleDeletePost(postId: string, photoPath: string, frontPhotoPath: string | null) {
    Alert.alert(
      "Delete Post",
      "This will permanently delete this post. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            // Optimistic removal
            removePost(postId);

            const { error } = await supabase.from("posts").delete().eq("id", postId);
            if (error) {
              showToast("Failed to delete post", "error");
              refreshPosts();
              return;
            }

            // Clean up storage files (fire-and-forget)
            deleteImage(photoPath);
            if (frontPhotoPath) deleteImage(frontPhotoPath);

            showToast("Post deleted", "success");
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <Text style={{ color: colors.text }}>No profile found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header with logo and settings */}
      <View
        style={{
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.background,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Image
          source={require("../../assets/images/euda.png")}
          style={{ width: 120, height: 48, marginLeft: -8 }}
          resizeMode="contain"
        />
        <Pressable onPress={() => router.push("/settings" as any)} hitSlop={8} accessibilityLabel="Settings" accessibilityRole="button">
          <Ionicons name="settings-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView ref={scrollViewRef} style={{ flex: 1 }}>
        <View style={{ padding: 24 }}>
        <View style={{ gap: 24 }}>
          {/* Avatar with upload button */}
          <Pressable onPress={handleAvatarUpload} disabled={uploadingAvatar} accessibilityLabel="Change profile photo" accessibilityRole="button" accessibilityState={{ disabled: uploadingAvatar }}>
            <View style={{ alignSelf: "center", position: "relative" }}>
              <Avatar avatarUrl={profile.avatar_url} size={80} />
              {uploadingAvatar && (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: colors.overlay,
                    borderRadius: 40,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <ActivityIndicator color={Colors.white} />
                </View>
              )}
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: Colors.primary,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: Colors.white, fontSize: 16 }}>+</Text>
              </View>
            </View>
          </Pressable>

          {/* Username and bio */}
          <View style={{ gap: 8, alignItems: "center" }}>
            <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>{profile.username}</Text>
            {profile.bio ? (
              <Pressable onPress={handleEditBio} accessibilityLabel="Edit bio" accessibilityRole="button">
                <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: "center" }}>
                  {profile.bio}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={handleEditBio} accessibilityLabel="Add a bio" accessibilityRole="button">
                <Text style={{ fontSize: 14, color: colors.textTertiary, textAlign: "center" }}>
                  Add a bio
                </Text>
              </Pressable>
            )}
          </View>

          {/* Stats - centered and evenly spaced */}
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
              onPress={() => setShowFriends(true)}
              accessibilityLabel={`${friends.length} friends — tap to view`}
              accessibilityRole="button"
              style={{ alignItems: "center", gap: 4, flex: 1 }}
            >
              <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{friends.length}</Text>
              <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                Friends
              </Text>
            </Pressable>
          </View>

          {/* Friend Actions */}
          <View style={{ gap: 12 }}>
            {/* Friend Requests Button with Badge */}
            {requests.length > 0 && (
              <Pressable
                onPress={() => setShowFriendRequests(true)}
                accessibilityLabel={`${requests.length} friend request${requests.length === 1 ? "" : "s"}`}
                accessibilityRole="button"
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  borderRadius: 20,
                  backgroundColor: Colors.error,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.white }}>
                  Friend Requests
                </Text>
                <View
                  style={{
                    backgroundColor: Colors.white,
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    minWidth: 24,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "700", color: Colors.error }}>
                    {requests.length}
                  </Text>
                </View>
              </Pressable>
            )}

            {/* People You May Know */}
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                People You May Know
              </Text>

              {/* Contact sync prompt — first time only */}
              {!lastSyncedAt && !dismissedSyncCard && contactsSyncEnabled && (
                <View
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="people-outline" size={22} color={Colors.primary} />
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text, flex: 1 }}>
                      Find friends from your contacts
                    </Text>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
                    We&apos;ll match phone numbers privately — only hashes are sent, never your actual contacts.
                  </Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                    <Pressable
                      onPress={async () => {
                        const ok = await syncNow();
                        if (ok) refreshRecs();
                      }}
                      disabled={contactSyncing}
                      accessibilityLabel="Find friends from contacts"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: contactSyncing }}
                      style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: Colors.primary,
                        alignItems: "center",
                        opacity: contactSyncing ? 0.6 : 1,
                      }}
                    >
                      {contactSyncing ? (
                        <ActivityIndicator color={Colors.white} size="small" />
                      ) : (
                        <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.white }}>
                          Find Friends
                        </Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => setDismissedSyncCard(true)}
                      accessibilityLabel="Not now"
                      accessibilityRole="button"
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 16,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontSize: 14, color: colors.textSecondary }}>Not Now</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {recsLoading || contactSyncing ? (
                <ActivityIndicator />
              ) : recommendations.length > 0 ? (
                recommendations.map((rec) => (
                  <View
                    key={rec.user_id}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                  >
                    <Avatar avatarUrl={rec.avatar_url} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
                        {rec.username}
                      </Text>
                      <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                        {rec.source === "contact"
                          ? "From your contacts"
                          : `${rec.mutual_count} mutual friend${rec.mutual_count !== 1 ? "s" : ""}`}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => sendRequest(rec.user_id)}
                      accessibilityLabel={`Add ${rec.username}`}
                      accessibilityRole="button"
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 14,
                        borderRadius: 16,
                        backgroundColor: Colors.primary,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.white }}>
                        Add
                      </Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                  No suggestions yet — add some friends to get started!
                </Text>
              )}

              {/* Search CTA */}
              <Pressable onPress={() => setShowUserSearch(true)} accessibilityLabel="Search for friends" accessibilityRole="button">
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color: Colors.primary,
                    textAlign: "center",
                  }}
                >
                  Search for friends
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Sign Out Button */}
          <Pressable
            onPress={handleSignOut}
            accessibilityLabel="Sign out"
            accessibilityRole="button"
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: colors.text,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
              Sign Out
            </Text>
          </Pressable>
        </View>

        {/* Upcoming Plans */}
        {!plansLoading && plans.length > 0 && (
          <View style={{ marginTop: 32 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 12, color: colors.text }}>
              Upcoming
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -24 }}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}
            >
              {plans.map((plan) => (
                <Pressable
                  key={plan.id}
                  onPress={() => router.push(`/event/${plan.id}` as any)}
                  accessibilityLabel={plan.title}
                  accessibilityRole="button"
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

        {/* Posts grid */}
        <View style={{ marginTop: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 16, color: colors.text }}>
            Your Posts ({posts.length})
          </Text>

          {postsLoading ? (
            <ActivityIndicator />
          ) : posts.length === 0 ? (
            <Text style={{ textAlign: "center", color: colors.textSecondary, paddingVertical: 32 }}>
              No posts yet. Check in at an event to create your first post!
            </Text>
          ) : (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: GRID_GAP,
              }}
            >
              {posts.map((post) => (
                <Pressable
                  key={post.id}
                  onPress={() => router.push(`/post/${post.id}` as any)}
                  onLongPress={() => handleDeletePost(post.id, post.photo_path, post.front_photo_path)}
                  accessibilityLabel="View post"
                  accessibilityRole="button"
                  accessibilityHint="Long press to delete"
                  style={{
                    width: postSize,
                    height: postSize,
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
      </View>

      {/* Modals */}
      <UserSearchSheet
        visible={showUserSearch}
        onClose={() => setShowUserSearch(false)}
        onViewProfile={(userId) => {
          setShowUserSearch(false);
          router.push(`/user/${userId}` as any);
        }}
      />
      <FriendsSheet
        visible={showFriends}
        onClose={() => setShowFriends(false)}
        onFriendTap={handleFriendTap}
      />
      <FriendRequestsSheet
        visible={showFriendRequests}
        onClose={() => setShowFriendRequests(false)}
        onViewProfile={(userId) => {
          setShowFriendRequests(false);
          router.push(`/user/${userId}` as any);
        }}
        onRequestHandled={(action) => {
          // Optimistic: refresh the profile page's own hook instances
          refreshRequests();
          if (action === "accepted") refreshFriends();
        }}
      />

      {/* Bio Edit Modal */}
      <Modal
        visible={showBioEdit}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBioEdit(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              paddingTop: insets.top + 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.separator,
            }}
          >
            <Pressable onPress={() => setShowBioEdit(false)} accessibilityLabel="Cancel" accessibilityRole="button">
              <Text style={{ fontSize: 16, color: Colors.primary }}>Cancel</Text>
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>Edit Bio</Text>
            <Pressable onPress={handleSaveBio} disabled={savingBio} accessibilityLabel="Save bio" accessibilityRole="button" accessibilityState={{ disabled: savingBio }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: savingBio ? colors.textTertiary : Colors.primary,
                }}
              >
                {savingBio ? "..." : "Save"}
              </Text>
            </Pressable>
          </View>

          <View style={{ padding: 16 }}>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Tell us about yourself..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={150}
              accessibilityLabel="Bio"
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: colors.separator,
                fontSize: 16,
                minHeight: 100,
                textAlignVertical: "top",
                color: colors.text,
                backgroundColor: colors.inputBg,
              }}
            />
            <Text style={{ marginTop: 8, fontSize: 12, color: colors.textTertiary, textAlign: "right" }}>
              {bio.length}/150
            </Text>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}
