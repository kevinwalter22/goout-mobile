import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import type { PostPlace, MapPost } from "../lib/mapPosts";

// Social map: the "who's been here" sheet for a tapped check-in place bubble. Lists the
// check-ins at that place (most-recent first) — poster, when, caption, and their photo.

function relativeTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

function Row({ post, colors }: { post: MapPost; colors: any }) {
  const thumb = post.pinImageUrl || post.avatarUrl || null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}>
      {thumb ? (
        <Image
          source={{ uri: thumb }}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.border }}
        />
      ) : (
        <View
          style={{
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: colors.border, alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="camera" size={20} color={colors.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "600" }} numberOfLines={1}>
          {post.username || "Someone"}
        </Text>
        {!!post.caption && (
          <Text style={{ color: colors.textSecondary, marginTop: 2 }} numberOfLines={2}>
            {post.caption}
          </Text>
        )}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{relativeTime(post.createdAt)}</Text>
    </View>
  );
}

export function WhoBeenHereSheet({
  place,
  onClose,
}: {
  place: PostPlace | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const visible = !!place;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 20,
          paddingTop: 14,
          paddingBottom: 34,
          maxHeight: "70%",
        }}
      >
        <View style={{ alignItems: "center", marginBottom: 8 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
            {place && place.count > 1 ? `${place.count} check-ins here` : "Check-in"}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
        <ScrollView>
          {(place?.posts || []).map((p) => (
            <Row key={p.id} post={p} colors={colors} />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
