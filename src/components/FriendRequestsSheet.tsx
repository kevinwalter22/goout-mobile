import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useFriendRequests } from "../hooks/useFriendRequests";
import { useFriendship } from "../hooks/useFriendship";
import { Avatar } from "./Avatar";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";

type FriendRequestsSheetProps = {
  visible: boolean;
  onClose: () => void;
  onViewProfile?: (userId: string) => void;
};

export function FriendRequestsSheet({ visible, onClose, onViewProfile }: FriendRequestsSheetProps) {
  const { requests, loading, refresh } = useFriendRequests();
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
          <Text style={[styles.title, { color: colors.text }]}>
            Friend Requests ({requests.length})
          </Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* Friend Requests List */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && requests.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.text }]}>No friend requests</Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              When someone sends you a friend request, it will appear here.
            </Text>
          </View>
        )}

        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FriendRequestItem request={item} onResponse={refresh} onViewProfile={onViewProfile} />
          )}
        />
      </View>
    </Modal>
  );
}

// Sub-component for each friend request
function FriendRequestItem({
  request,
  onResponse,
  onViewProfile,
}: {
  request: { id: string; user_id: string; username: string; avatar_url: string | null };
  onResponse: () => void;
  onViewProfile?: (userId: string) => void;
}) {
  const { acceptFriendRequest, declineFriendRequest, loading } = useFriendship(request.user_id);
  const { colors } = useTheme();

  async function handleAccept() {
    await acceptFriendRequest();
    onResponse();
  }

  async function handleDecline() {
    await declineFriendRequest();
    onResponse();
  }

  return (
    <View style={[styles.requestItem, { borderBottomColor: colors.borderLight }]}>
      <Pressable
        style={styles.requestProfile}
        onPress={() => onViewProfile?.(request.user_id)}
      >
        <Avatar avatarUrl={request.avatar_url} size={50} />
        <View style={styles.requestInfo}>
          <Text style={[styles.requestUsername, { color: colors.text }]}>{request.username}</Text>
          <Text style={[styles.requestSubtext, { color: colors.textSecondary }]}>wants to be friends</Text>
        </View>
      </Pressable>
      <View style={styles.requestActions}>
        <Pressable
          onPress={handleAccept}
          disabled={loading}
          style={[styles.acceptButton, { backgroundColor: Colors.primary }]}
        >
          <Text style={styles.acceptButtonText}>
            {loading ? "..." : "Accept"}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleDecline}
          disabled={loading}
          style={[styles.declineButton, { backgroundColor: colors.surfaceVariant }]}
        >
          <Text style={[styles.declineButtonText, { color: colors.textSecondary }]}>
            {loading ? "..." : "Decline"}
          </Text>
        </Pressable>
      </View>
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
  requestItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  requestProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  requestInfo: {
    flex: 1,
  },
  requestUsername: {
    fontSize: 16,
    fontWeight: "600",
  },
  requestSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  requestActions: {
    flexDirection: "column",
    gap: 8,
  },
  acceptButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#007AFF",
    minWidth: 80,
    alignItems: "center",
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  declineButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    minWidth: 80,
    alignItems: "center",
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
});
