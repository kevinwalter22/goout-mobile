import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useModerationInbox,
  type ModerationFlag,
} from "../../src/hooks/useModerationInbox";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";

/* ------------------------------------------------------------------ */
/*  Filter chips                                                       */
/* ------------------------------------------------------------------ */

const TARGET_TYPES = ["All", "post", "comment", "event", "profile", "Explore_Item"] as const;
const SOURCES = ["All", "auto_text", "auto_image", "user_report"] as const;

const TYPE_LABEL: Record<string, string> = {
  post: "Post",
  comment: "Comment",
  event: "Event",
  profile: "Profile",
  explore_item: "Explore Item",
  Explore_Item: "Explore Item",
};

/** Returns a route to navigate to the flagged content, if possible. */
function contentRoute(targetType: string, targetId: string): string | null {
  const t = targetType.toLowerCase();
  if (t === "explore_item") return `/event/${targetId}`;
  if (t === "post") return `/post/${targetId}`;
  if (t === "profile") return `/user/${targetId}`;
  return null;
}

function FilterChip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: active ? colors.text : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.text : colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: active ? colors.background : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Category badge                                                     */
/* ------------------------------------------------------------------ */

const CATEGORY_COLORS: Record<string, string> = {
  hate_speech: Colors.error,
  harassment: "#E11D48",
  sexual_content: "#9333EA",
  spam: Colors.warning,
  profanity: "#D97706",
  other: "#6B7280",
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color }}>
        {category.replace(/_/g, " ")}
      </Text>
    </View>
  );
}

function SeverityBadge({ severity }: { severity: number }) {
  const color =
    severity >= 80
      ? Colors.error
      : severity >= 50
        ? Colors.warning
        : "#6B7280";
  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color }}>
        {severity}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Target type icon                                                   */
/* ------------------------------------------------------------------ */

function targetIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "post":
      return "image-outline";
    case "comment":
      return "chatbubble-outline";
    case "event":
      return "calendar-outline";
    case "profile":
      return "person-outline";
    default:
      return "flag-outline";
  }
}

/* ------------------------------------------------------------------ */
/*  Flag card                                                          */
/* ------------------------------------------------------------------ */

function FlagCard({
  flag,
  onApprove,
  onRemove,
  onSuspend,
  onShadowban,
  colors,
}: {
  flag: ModerationFlag;
  onApprove: () => void;
  onRemove: () => void;
  onSuspend: () => void;
  onShadowban: () => void;
  colors: any;
}) {
  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 10,
      }}
    >
      {/* Header: type icon + label + category + severity */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons
          name={targetIcon(flag.target_type)}
          size={18}
          color={colors.textSecondary}
        />
        <Text
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: "600",
            color: colors.text,
          }}
        >
          {TYPE_LABEL[flag.target_type] ?? flag.target_type}
        </Text>
        <CategoryBadge category={flag.category} />
        <SeverityBadge severity={flag.severity} />
      </View>

      {/* Content reference: target ID + author */}
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 11, fontFamily: "monospace", color: colors.textTertiary }}>
          ID: …{flag.target_id.slice(-8)}
        </Text>
        {flag.metadata?.author_id && (
          <Text style={{ fontSize: 11, fontFamily: "monospace", color: colors.textTertiary }}>
            Author: …{String(flag.metadata.author_id).slice(-8)}
          </Text>
        )}
      </View>

      {/* View content link */}
      {contentRoute(flag.target_type, flag.target_id) && (
        <Pressable
          onPress={() => router.push(contentRoute(flag.target_type, flag.target_id) as string)}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Ionicons name="open-outline" size={13} color={Colors.primary} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: Colors.primary }}>
            View Content
          </Text>
        </Pressable>
      )}

      {/* Source */}
      <Text style={{ fontSize: 12, color: colors.textTertiary }}>
        Source: {flag.source.replace(/_/g, " ")}
        {flag.flagged_by ? ` \u00B7 Reported by user` : ""}
      </Text>

      {/* Reason */}
      {flag.reason && (
        <Text
          style={{ fontSize: 13, color: colors.textSecondary }}
          numberOfLines={3}
        >
          {flag.reason}
        </Text>
      )}

      {/* Timestamp */}
      <Text style={{ fontSize: 11, color: colors.textTertiary }}>
        {new Date(flag.created_at).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>

      {/* Actions row 1: Approve / Remove */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        <Pressable
          onPress={onApprove}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: Colors.success + "18",
          }}
        >
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text
            style={{ fontSize: 14, fontWeight: "600", color: Colors.success }}
          >
            Approve
          </Text>
        </Pressable>

        <Pressable
          onPress={onRemove}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: Colors.error + "18",
          }}
        >
          <Ionicons name="close-circle" size={18} color={Colors.error} />
          <Text
            style={{ fontSize: 14, fontWeight: "600", color: Colors.error }}
          >
            Remove
          </Text>
        </Pressable>
      </View>

      {/* Actions row 2: Suspend / Shadowban */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onSuspend}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: Colors.warning + "18",
          }}
        >
          <Ionicons name="time-outline" size={18} color={Colors.warning} />
          <Text
            style={{ fontSize: 13, fontWeight: "600", color: Colors.warning }}
          >
            Suspend
          </Text>
        </Pressable>

        <Pressable
          onPress={onShadowban}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: "#9333EA" + "18",
          }}
        >
          <Ionicons name="eye-off-outline" size={18} color="#9333EA" />
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#9333EA" }}>
            Shadowban
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export default function AdminModeration() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    flags,
    loading,
    error,
    fetchInbox,
    approveFlag,
    removeFlag,
    suspendUser,
    shadowbanUser,
  } = useModerationInbox();

  const [targetFilter, setTargetFilter] = useState<string>("All");
  const [sourceFilter, setSourceFilter] = useState<string>("All");

  useEffect(() => {
    fetchInbox(
      50,
      0,
      targetFilter === "All" ? undefined : targetFilter,
      sourceFilter === "All" ? undefined : sourceFilter,
    );
  }, [fetchInbox, targetFilter, sourceFilter]);

  /* ---- Action handlers ---- */

  function handleApprove(flag: ModerationFlag) {
    approveFlag(flag.id, flag.target_type, flag.target_id);
  }

  function handleRemove(flag: ModerationFlag) {
    Alert.alert(
      "Remove Content",
      `Block this ${flag.target_type}? It will be hidden from all users.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeFlag(flag.id, flag.target_type, flag.target_id),
        },
      ],
    );
  }

  function handleSuspend(flag: ModerationFlag) {
    const userId = flag.flagged_by ?? flag.metadata?.reporter_id;
    // For user reports we suspend the content author, not the reporter.
    // The target_id for posts/comments is the content id — we'd need the
    // author. For now, prompt admin for the user id from metadata or use
    // target_id when target_type is 'profile'.
    const targetUserId =
      flag.target_type === "profile"
        ? flag.target_id
        : flag.metadata?.author_id ?? null;

    if (!targetUserId) {
      Alert.alert(
        "Cannot Suspend",
        "No author information available for this flag.",
      );
      return;
    }

    Alert.alert("Suspend User", "Choose suspension duration:", [
      { text: "Cancel", style: "cancel" },
      { text: "24 hours", onPress: () => suspendUser(targetUserId, 24) },
      {
        text: "7 days",
        onPress: () => suspendUser(targetUserId, 24 * 7),
      },
      {
        text: "Permanent",
        style: "destructive",
        onPress: () => suspendUser(targetUserId),
      },
    ]);
  }

  function handleShadowban(flag: ModerationFlag) {
    const targetUserId =
      flag.target_type === "profile"
        ? flag.target_id
        : flag.metadata?.author_id ?? null;

    if (!targetUserId) {
      Alert.alert(
        "Cannot Shadowban",
        "No author information available for this flag.",
      );
      return;
    }

    Alert.alert(
      "Shadowban User",
      "Their content will be silently hidden from other users. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Shadowban",
          style: "destructive",
          onPress: () => shadowbanUser(targetUserId),
        },
      ],
    );
  }

  /* ---- Render ---- */

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Moderation Inbox" />

      {/* Filter chips */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {TARGET_TYPES.map((t) => (
            <FilterChip
              key={t}
              label={t === "All" ? "All types" : (TYPE_LABEL[t] ?? t)}
              active={targetFilter === t}
              onPress={() => setTargetFilter(t)}
              colors={colors}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {SOURCES.map((s) => (
            <FilterChip
              key={s}
              label={s === "All" ? "All sources" : s.replace(/_/g, " ")}
              active={sourceFilter === s}
              onPress={() => setSourceFilter(s)}
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      {loading && flags.length === 0 ? (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      ) : error && flags.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 24,
            gap: 12,
          }}
        >
          <Text
            style={{
              textAlign: "center",
              fontSize: 16,
              fontWeight: "600",
              color: colors.text,
            }}
          >
            Failed to load moderation inbox
          </Text>
          <Text style={{ textAlign: "center", color: colors.textSecondary }}>
            {error}
          </Text>
          <Pressable
            onPress={() => fetchInbox()}
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: colors.text,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.background,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : flags.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
            gap: 12,
          }}
        >
          <Ionicons
            name="checkmark-done-circle-outline"
            size={48}
            color={Colors.success}
          />
          <Text
            style={{ fontSize: 18, fontWeight: "600", color: colors.text }}
          >
            All clear
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: colors.textSecondary,
              textAlign: "center",
            }}
          >
            No open moderation flags.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 16,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>
            {flags.length} flag{flags.length !== 1 ? "s" : ""} open
          </Text>
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              onApprove={() => handleApprove(flag)}
              onRemove={() => handleRemove(flag)}
              onSuspend={() => handleSuspend(flag)}
              onShadowban={() => handleShadowban(flag)}
              colors={colors}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
