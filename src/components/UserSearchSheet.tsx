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

type User = {
  id: string;
  username: string;
};

type UserSearchSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function UserSearchSheet({ visible, onClose }: UserSearchSheetProps) {
  const { user: currentUser } = useAuth();
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

    const { data } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${query.trim()}%`)
      .limit(20);

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
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Add Friends</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={handleSearch}
            placeholder="Search by username..."
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
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
            <Text style={styles.emptyText}>No users found</Text>
          </View>
        )}

        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <UserSearchResultItem user={item} />}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Sub-component for each search result
function UserSearchResultItem({ user }: { user: User }) {
  const { isFriend, loading, toggleFriendship } = useFriendship(user.id);

  return (
    <View style={styles.resultItem}>
      <View style={styles.resultAvatar} />
      <Text style={styles.resultUsername}>{user.username}</Text>
      <Pressable
        onPress={toggleFriendship}
        disabled={loading}
        style={[
          styles.friendButton,
          isFriend && styles.friendButtonActive,
        ]}
      >
        <Text
          style={[
            styles.friendButtonText,
            isFriend && styles.friendButtonTextActive,
          ]}
        >
          {loading ? "..." : isFriend ? "Friends" : "Add"}
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
  resultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e0e0e0",
  },
  resultUsername: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  friendButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#007AFF",
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
