import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useState, useEffect } from "react";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { useFriendsList } from "../hooks/useFriendsList";
import { Avatar } from "./Avatar";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";

type FriendsGoingSheetProps = {
  visible: boolean;
  onClose: () => void;
  eventId: string | null;
  eventTitle: string;
};

type FriendGoing = {
  id: string;
  username: string;
  avatar_url: string | null;
};

export function FriendsGoingSheet({ visible, onClose, eventId, eventTitle }: FriendsGoingSheetProps) {
  const { friends } = useFriendsList();
  const { colors } = useTheme();
  const [friendsGoing, setFriendsGoing] = useState<FriendGoing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible && eventId) {
      loadFriendsGoing();
    }
  }, [visible, eventId, friends]);

  async function loadFriendsGoing() {
    if (!eventId) return;

    setLoading(true);

    // Get RSVPs for this event/item
    const { data: rsvpsData } = await supabase
      .from("explore_item_rsvps")
      .select("user_id")
      .eq("explore_item_id", eventId);

    if (!rsvpsData || rsvpsData.length === 0) {
      setFriendsGoing([]);
      setLoading(false);
      return;
    }

    // Filter for friends who are going
    const attendeeIds = rsvpsData.map((r: any) => r.user_id);
    const friendsGoingList = friends.filter((f) => attendeeIds.includes(f.id));

    setFriendsGoing(friendsGoingList);
    setLoading(false);
  }

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
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Friends Going</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{eventTitle}</Text>
          </View>
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

        {!loading && friendsGoing.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.text }]}>No friends going yet</Text>
            <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
              Be the first of your friends to check in!
            </Text>
          </View>
        )}

        {!loading && friendsGoing.length > 0 && (
          <FlatList
            data={friendsGoing}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push(`/user/${item.id}` as any);
                }}
                style={[styles.friendItem, { borderBottomColor: colors.borderLight }]}
              >
                <Avatar avatarUrl={item.avatar_url} size={40} />
                <Text style={[styles.friendUsername, { color: colors.text }]}>{item.username}</Text>
                <Text style={styles.viewProfile}>View →</Text>
              </Pressable>
            )}
          />
        )}
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
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginTop: 2,
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
