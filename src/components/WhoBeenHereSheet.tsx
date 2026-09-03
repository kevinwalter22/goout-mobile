import { useEffect } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "../contexts/ThemeContext";
import type { PostPlace, MapPost } from "../lib/mapPosts";

// Social map: the "who's been here" sheet for a tapped check-in place. Lists the check-ins
// there (most-recent first) — poster, when, caption, photo. Tapping a row opens that post.
// It's pulled up / closed with the OS's native Modal slide (unchanged from before). The one
// new capability: you can drag/swipe the handle down to dismiss (as well as ✕ / tap-map).

const SPRING = { damping: 22, stiffness: 220 };

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

function Row({ post, colors, onPress }: { post: MapPost; colors: any; onPress: () => void }) {
  const thumb = post.pinImageUrl || post.avatarUrl || null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="View post"
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 }}
    >
      {thumb ? (
        <Image
          source={{ uri: thumb }}
          style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.border }}
        />
      ) : (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
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
      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
    </Pressable>
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
  // Drag offset only. The entrance/exit is the native Modal slide (below); translateY just
  // tracks the finger while dragging, so we reset it to rest whenever the sheet (re)opens.
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  // Drag the handle down to dismiss: past ~120px or a fast flick closes (native slide-down
  // continues from the dragged position); otherwise it springs back to rest.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, SPRING);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose} />
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingBottom: 34,
              maxHeight: "70%",
            },
            sheetStyle,
          ]}
        >
          {/* Draggable header — grab the handle/title and swipe down to dismiss. */}
          <GestureDetector gesture={pan}>
            <View style={{ paddingTop: 12 }}>
              <View style={{ alignItems: "center", marginBottom: 10 }}>
                <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border }} />
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>
                  {place && place.count > 1 ? `${place.count} check-ins here` : "Check-in"}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <Ionicons name="close" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>
            </View>
          </GestureDetector>
          <ScrollView>
            {(place?.posts || []).map((p) => (
              <Row
                key={p.id}
                post={p}
                colors={colors}
                onPress={() => {
                  onClose();
                  router.push(`/post/${p.id}` as any);
                }}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
