import { useEffect } from "react";
import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFriendsList } from "../hooks/useFriendsList";
import { useFriendship } from "../hooks/useFriendship";
import { Avatar } from "./Avatar";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";

type FriendsSheetProps = {
  visible: boolean;
  onClose: () => void;
  onFriendTap?: (friendId: string) => void;
};

export function FriendsSheet({ visible, onClose, onFriendTap }: FriendsSheetProps) {
  const { friends, loading, refresh } = useFriendsList();
  const { colors } = useTheme();

  // Modal stays mounted across visibility toggles, so the hook's mount-time
  // fetch goes stale if the user accepts a friend request while the sheet
  // is closed. Refresh whenever the sheet opens.
  useEffect(() => {
    if (visible) refresh();
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.title, { color: colors.text }]}>Friends ({friends.length})</Text>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityLabel="Close" accessibilityRole="button">
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* Friends List */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && friends.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.text }]}>No friends yet</Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Add friends to see their posts in your feed!
            </Text>
          </View>
        )}

        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FriendListItem friend={item} onRemove={refresh} onTap={onFriendTap} />
          )}
        />
      </View>
    </Modal>
  );
}

// Sub-component for each friend
function FriendListItem({
  friend,
  onRemove,
  onTap,
}: {
  friend: { id: string; username: string; avatar_url: string | null };
  onRemove: () => void;
  onTap?: (friendId: string) => void;
}) {
  const { removeFriend, loading } = useFriendship(friend.id);
  const { colors } = useTheme();

  async function handleRemove() {
    Alert.alert(
      "Remove Friend?",
      `Remove ${friend.username} from your friends list?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeFriend();
            onRemove();
          },
        },
      ]
    );
  }

  return (
    <Pressable
      style={[styles.friendItem, { borderBottomColor: colors.borderLight }]}
      onPress={() => onTap?.(friend.id)}
      disabled={!onTap}
      accessibilityLabel={onTap ? `View ${friend.username}'s profile` : friend.username}
      accessibilityRole={onTap ? "button" : "text"}
    >
      <Avatar avatarUrl={friend.avatar_url} size={40} />
      <Text style={[styles.friendUsername, { color: colors.text }]}>{friend.username}</Text>
      <Pressable
        onPress={handleRemove}
        disabled={loading}
        accessibilityLabel={`Remove ${friend.username}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading }}
        style={styles.removeButton}
      >
        <Text style={[styles.removeButtonText, { color: Colors.error }]}>
          {loading ? "..." : "Remove"}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    fontSize: 24,
    color: "#666",
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyContainer: {
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
  },
  emptyHint: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },
  friendItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e0e0e0",
  },
  friendUsername: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButtonText: {
    fontSize: 14,
    color: "#ff3b30",
    fontWeight: "600",
  },
});
