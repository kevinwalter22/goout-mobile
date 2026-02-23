import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useFriendship } from "../hooks/useFriendship";
import { Avatar } from "./Avatar";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";

type User = {
  id: string;
  username: string;
  avatar_url: string | null;
};

type UserSearchSheetProps = {
  visible: boolean;
  onClose: () => void;
  onViewProfile?: (userId: string) => void;
};

export function UserSearchSheet({ visible, onClose, onViewProfile }: UserSearchSheetProps) {
  const { user: currentUser } = useAuth();
  const { colors } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(query: string) {
    setSearchQuery(query);

    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);

    // Use secure RPC that only returns public fields (id, username, avatar_url)
    const { data } = await supabase.rpc("search_profiles", {
      query: query.trim(),
    });

    // Filter out current user
    const filtered = (data || []).filter((u: any) => u.id !== currentUser?.id);

    setResults(filtered);
    setLoading(false);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.surface }]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.separator }]}>
          <Text style={[styles.title, { color: colors.text }]}>Add Friends</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search by username..."
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { backgroundColor: colors.inputBg, color: colors.text }]}
          />
        </View>

        {/* Results List */}
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator />
          </View>
        )}

        {!loading && results.length === 0 && searchQuery.length >= 2 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No users found</Text>
          </View>
        )}

        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <UserSearchResultItem user={item} onViewProfile={onViewProfile} />}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Sub-component for each search result
function UserSearchResultItem({ user, onViewProfile }: { user: User; onViewProfile?: (userId: string) => void }) {
  const { status, loading, sendFriendRequest, cancelFriendRequest, removeFriend } = useFriendship(user.id);
  const { colors } = useTheme();

  function handlePress() {
    if (status === "none") {
      sendFriendRequest();
    } else if (status === "pending_sent") {
      cancelFriendRequest();
    } else if (status === "accepted") {
      removeFriend();
    }
  }

  function getButtonText() {
    if (loading) return "...";
    if (status === "none") return "Add Friend";
    if (status === "pending_sent") return "Requested";
    if (status === "pending_received") return "Accept";
    if (status === "accepted") return "Friends";
    return "Add Friend";
  }

  return (
    <View style={[styles.resultItem, { borderBottomColor: colors.borderLight }]}>
      <Pressable
        style={styles.resultProfile}
        onPress={() => onViewProfile?.(user.id)}
      >
        <Avatar avatarUrl={user.avatar_url} size={40} />
        <Text style={[styles.resultUsername, { color: colors.text }]}>{user.username}</Text>
      </Pressable>
      <Pressable
        onPress={handlePress}
        disabled={loading || status === "pending_received"}
        style={[
          styles.friendButton,
          (status === "accepted" || status === "pending_sent") && [styles.friendButtonActive, { backgroundColor: colors.surfaceVariant }],
        ]}
      >
        <Text
          style={[
            styles.friendButtonText,
            (status === "accepted" || status === "pending_sent") && [styles.friendButtonTextActive, { color: colors.textSecondary }],
          ]}
        >
          {getButtonText()}
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
  searchContainer: {
    padding: 16,
  },
  searchInput: {
    padding: 12,
    borderRadius: 20,
    backgroundColor: "#f5f5f5",
    fontSize: 14,
  },
  loadingContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyContainer: {
    padding: 24,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  resultProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  resultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e0e0e0",
  },
  resultUsername: {
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  friendButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  friendButtonActive: {
    backgroundColor: "#f5f5f5",
  },
  friendButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  friendButtonTextActive: {
    color: "#666",
  },
});
