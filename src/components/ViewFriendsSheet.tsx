import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useFriendsList } from "../hooks/useFriendsList";
import { Avatar } from "./Avatar";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";

type ViewFriendsSheetProps = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  username: string;
  onFriendTap?: (friendId: string) => void;
};

/**
 * Read-only friends list sheet for viewing another user's friends
 */
export function ViewFriendsSheet({
  visible,
  onClose,
  userId,
  username,
  onFriendTap,
}: ViewFriendsSheetProps) {
  const { friends, loading } = useFriendsList(userId);
  const { colors } = useTheme();

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
          <Text style={[styles.title, { color: colors.text }]}>{username}'s Friends ({friends.length})</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* Friends List */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        )}

        {!loading && friends.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.text }]}>No friends yet</Text>
          </View>
        )}

        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.friendItem, { borderBottomColor: colors.borderLight }]}
              onPress={() => onFriendTap?.(item.id)}
              disabled={!onFriendTap}
            >
              <Avatar avatarUrl={item.avatar_url} size={40} />
              <Text style={[styles.friendUsername, { color: colors.text }]}>{item.username}</Text>
              {onFriendTap && (
                <Text style={styles.viewProfile}>View →</Text>
              )}
            </Pressable>
          )}
        />
      </View>
    </Modal>
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
    flex: 1,
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
  friendItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  friendUsername: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  viewProfile: {
    fontSize: 14,
    color: Colors.primary,
  },
});
