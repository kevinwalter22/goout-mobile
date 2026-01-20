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
import { useFriendship } from "../hooks/useFriendship";

type FriendsSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function FriendsSheet({ visible, onClose }: FriendsSheetProps) {
  const { friends, loading, refresh } = useFriendsList();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Friends ({friends.length})</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
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
            <Text style={styles.emptyText}>No friends yet</Text>
            <Text style={styles.emptyHint}>
              Add friends to see their posts in your feed!
            </Text>
          </View>
        )}

        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FriendListItem friend={item} onRemove={refresh} />
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
}: {
  friend: { id: string; username: string };
  onRemove: () => void;
}) {
  const { toggleFriendship, loading } = useFriendship(friend.id);

  async function handleRemove() {
    await toggleFriendship();
    onRemove();
  }

  return (
    <View style={styles.friendItem}>
      <View style={styles.friendAvatar} />
      <Text style={styles.friendUsername}>{friend.username}</Text>
      <Pressable
        onPress={handleRemove}
        disabled={loading}
        style={styles.removeButton}
      >
        <Text style={styles.removeButtonText}>
          {loading ? "..." : "Remove"}
        </Text>
      </Pressable>
    </View>
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
