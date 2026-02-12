import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useReviewQueue, type QuarantinedItem } from "../../src/hooks/useReviewQueue";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;

  const color =
    confidence >= 70
      ? Colors.success
      : confidence >= 50
        ? Colors.warning
        : Colors.error;

  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "600", color }}>
        {confidence}%
      </Text>
    </View>
  );
}

function QueueCard({
  item,
  onApprove,
  onReject,
  colors,
}: {
  item: QuarantinedItem;
  onApprove: () => void;
  onReject: () => void;
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
      {/* Title + Confidence */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          style={{ flex: 1, fontSize: 16, fontWeight: "600", color: colors.text }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <ConfidenceBadge confidence={item.normalized_confidence} />
      </View>

      {/* Meta info */}
      {item.category && (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {item.category}
          {item.town ? ` \u00B7 ${item.town}` : ""}
        </Text>
      )}
      {item.location_name && (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {item.location_name}
        </Text>
      )}
      {item.starts_at && (
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
          {new Date(item.starts_at).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      )}

      {/* Source URL */}
      {item.source_url && (
        <Pressable onPress={() => Linking.openURL(item.source_url!)}>
          <Text style={{ fontSize: 12, color: Colors.primary }} numberOfLines={1}>
            {item.source_url}
          </Text>
        </Pressable>
      )}

      {/* Provenance extraction method */}
      {item.provenance?.extraction_method && (
        <Text style={{ fontSize: 11, color: colors.textTertiary }}>
          Extracted via {item.provenance.extraction_method}
          {item.provenance.target_name ? ` from ${item.provenance.target_name}` : ""}
        </Text>
      )}

      {/* Action buttons */}
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
          <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.success }}>
            Approve
          </Text>
        </Pressable>

        <Pressable
          onPress={onReject}
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
          <Text style={{ fontSize: 14, fontWeight: "600", color: Colors.error }}>
            Reject
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminReview() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { items, loading, error, fetchQueue, approveItem, rejectItem } =
    useReviewQueue();

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  function handleReject(item: QuarantinedItem) {
    Alert.alert(
      "Reject Item",
      `Reject "${item.title}"? This hides it from explore.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: () => rejectItem(item.id, "rejected_by_admin"),
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: "Review Queue",
          headerShown: true,
        }}
      />

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : error && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
          <Text style={{ textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.text }}>
            Failed to load review queue
          </Text>
          <Text style={{ textAlign: "center", color: colors.textSecondary }}>
            {error}
          </Text>
          <Pressable
            onPress={() => fetchQueue()}
            style={{
              padding: 16,
              borderRadius: 12,
              backgroundColor: colors.text,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.background, fontSize: 16, fontWeight: "600" }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
            gap: 12,
          }}
        >
          <Ionicons name="checkmark-done-circle-outline" size={48} color={Colors.success} />
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.text }}>
            All clear
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: colors.textSecondary,
              textAlign: "center",
            }}
          >
            No quarantined items to review.
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
            {items.length} item{items.length !== 1 ? "s" : ""} awaiting review
          </Text>
          {items.map((item) => (
            <QueueCard
              key={item.id}
              item={item}
              onApprove={() => approveItem(item.id)}
              onReject={() => handleReject(item)}
              colors={colors}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
