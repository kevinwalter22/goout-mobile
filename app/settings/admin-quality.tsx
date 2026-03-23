import { useCallback, useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { supabase } from "../../src/lib/supabase";

type Tab = "audit" | "feedback";

interface AuditItem {
  id: string;
  title: string;
  category: string | null;
  sub_category: string | null;
  tags: string[] | null;
  tag_count: number;
  normalized_confidence: number | null;
  relevance_tier: number | null;
  is_admin_suppressed: boolean;
  source_name: string | null;
  kind: string;
}

interface FeedbackItem {
  explore_item_id: string;
  title: string;
  kind: string;
  category: string | null;
  net_score: number;
  upvote_count: number;
  confirm_count: number;
  downvote_count: number;
  closed_count: number;
  total_count: number;
  is_admin_suppressed: boolean;
  admin_suppressed_reason: string | null;
}

function TierBadge({ tier }: { tier: number | null }) {
  const labels: Record<number, { text: string; color: string }> = {
    3: { text: "Premium", color: Colors.success },
    2: { text: "Standard", color: Colors.primary },
    1: { text: "Marginal", color: Colors.warning },
    0: { text: "Suppressed", color: Colors.error },
  };
  const info = labels[tier ?? 2] ?? labels[2];
  return (
    <View
      style={{
        backgroundColor: info.color + "20",
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: info.color }}>
        T{tier ?? "?"} {info.text}
      </Text>
    </View>
  );
}

function AuditCard({
  item,
  onSuppress,
  onUnsuppress,
  colors,
}: {
  item: AuditItem;
  onSuppress: () => void;
  onUnsuppress: () => void;
  colors: any;
}) {
  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: item.is_admin_suppressed
          ? colors.error + "08"
          : colors.surface,
        borderWidth: 1,
        borderColor: item.is_admin_suppressed ? Colors.error + "30" : colors.border,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: "600",
            color: colors.text,
          }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <TierBadge tier={item.relevance_tier} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {item.category && (
          <Text style={{ fontSize: 12, color: colors.textSecondary }}>
            {item.category}
          </Text>
        )}
        {item.sub_category && (
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            / {item.sub_category}
          </Text>
        )}
        <Text style={{ fontSize: 12, color: colors.textTertiary }}>
          {item.kind} | {item.source_name ?? "unknown"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
          Conf: {item.normalized_confidence ?? "N/A"}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
          Tags: {item.tag_count}
        </Text>
        {item.is_admin_suppressed && (
          <Text style={{ fontSize: 12, fontWeight: "600", color: Colors.error }}>
            SUPPRESSED
          </Text>
        )}
      </View>

      {item.tags && item.tags.length > 0 && (
        <Text
          style={{ fontSize: 11, color: colors.textTertiary }}
          numberOfLines={2}
        >
          {item.tags.join(", ")}
        </Text>
      )}

      <Pressable
        onPress={item.is_admin_suppressed ? onUnsuppress : onSuppress}
        style={{
          marginTop: 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: item.is_admin_suppressed
            ? Colors.success + "18"
            : Colors.error + "18",
        }}
      >
        <Ionicons
          name={item.is_admin_suppressed ? "eye-outline" : "eye-off-outline"}
          size={16}
          color={item.is_admin_suppressed ? Colors.success : Colors.error}
        />
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: item.is_admin_suppressed ? Colors.success : Colors.error,
          }}
        >
          {item.is_admin_suppressed ? "Unsuppress" : "Suppress"}
        </Text>
      </Pressable>
    </View>
  );
}

function FeedbackCard({
  item,
  onSuppress,
  onUnsuppress,
  colors,
}: {
  item: FeedbackItem;
  onSuppress: () => void;
  onUnsuppress: () => void;
  colors: any;
}) {
  const isNegative = item.net_score < 0;
  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: isNegative ? Colors.error + "08" : colors.surface,
        borderWidth: 1,
        borderColor: isNegative ? Colors.error + "30" : colors.border,
        padding: 14,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.text }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <View
          style={{
            backgroundColor: (isNegative ? Colors.error : Colors.success) + "20",
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: isNegative ? Colors.error : Colors.success,
            }}
          >
            {item.net_score >= 0 ? "+" : ""}{item.net_score}
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 12, color: colors.textSecondary }}>
        {item.kind} | {item.category ?? "uncategorized"}
      </Text>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Text style={{ fontSize: 12, color: Colors.success }}>
          +{item.upvote_count} useful
        </Text>
        <Text style={{ fontSize: 12, color: Colors.primary }}>
          +{item.confirm_count} confirmed
        </Text>
        <Text style={{ fontSize: 12, color: Colors.warning }}>
          -{item.downvote_count} irrelevant
        </Text>
        <Text style={{ fontSize: 12, color: Colors.error }}>
          -{item.closed_count} closed
        </Text>
      </View>

      {item.is_admin_suppressed && (
        <Text style={{ fontSize: 12, fontWeight: "600", color: Colors.error }}>
          SUPPRESSED ({item.admin_suppressed_reason ?? "manual"})
        </Text>
      )}

      <Pressable
        onPress={item.is_admin_suppressed ? onUnsuppress : onSuppress}
        style={{
          marginTop: 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: item.is_admin_suppressed
            ? Colors.success + "18"
            : Colors.error + "18",
        }}
      >
        <Ionicons
          name={item.is_admin_suppressed ? "eye-outline" : "eye-off-outline"}
          size={16}
          color={item.is_admin_suppressed ? Colors.success : Colors.error}
        />
        <Text
          style={{
            fontSize: 13,
            fontWeight: "600",
            color: item.is_admin_suppressed ? Colors.success : Colors.error,
          }}
        >
          {item.is_admin_suppressed ? "Unsuppress" : "Suppress"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function AdminQuality() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("audit");
  const [items, setItems] = useState<AuditItem[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc(
      "admin_recurring_item_audit",
      { p_limit: 50 }
    );
    if (err) {
      setError(err.message);
    } else {
      setItems((data as AuditItem[]) ?? []);
    }
    setLoading(false);
  }, []);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc(
      "admin_negative_feedback_items",
      { p_limit: 50 }
    );
    if (err) {
      setError(err.message);
    } else {
      setFeedbackItems((data as FeedbackItem[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "audit") {
      fetchAudit();
    } else {
      fetchFeedback();
    }
  }, [tab, fetchAudit, fetchFeedback]);

  async function handleSuppress(itemId: string, title: string) {
    Alert.alert(
      "Suppress Item",
      `Suppress "${title}"? It will be hidden from all explore feeds.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Suppress",
          style: "destructive",
          onPress: async () => {
            const { error: err } = await supabase.rpc("admin_suppress_item", {
              p_item_id: itemId,
              p_reason: "manual_admin",
            });
            if (err) {
              Alert.alert("Error", err.message);
            } else {
              setItems((prev) =>
                prev.map((i) =>
                  i.id === itemId ? { ...i, is_admin_suppressed: true } : i
                )
              );
              setFeedbackItems((prev) =>
                prev.map((i) =>
                  i.explore_item_id === itemId ? { ...i, is_admin_suppressed: true } : i
                )
              );
            }
          },
        },
      ]
    );
  }

  async function handleUnsuppress(itemId: string) {
    const { error: err } = await supabase.rpc("admin_unsuppress_item", {
      p_item_id: itemId,
    });
    if (err) {
      Alert.alert("Error", err.message);
    } else {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, is_admin_suppressed: false } : i
        )
      );
      setFeedbackItems((prev) =>
        prev.map((i) =>
          i.explore_item_id === itemId ? { ...i, is_admin_suppressed: false } : i
        )
      );
    }
  }

  async function handleBulkSuppress() {
    Alert.alert(
      "Bulk Suppress",
      "Suppress all items with irrelevant sub-categories (hotels, storage, offices, etc.)?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Suppress",
          style: "destructive",
          onPress: async () => {
            const { data, error: err } = await supabase.rpc(
              "admin_bulk_suppress",
              {
                p_sub_categories: [
                  "lodging", "hotel", "motel",
                  "self storage", "storage facility",
                  "government office", "apartment complex",
                  "office", "corporate office",
                ],
                p_reason: "bulk_irrelevant_category",
              }
            );
            if (err) {
              Alert.alert("Error", err.message);
            } else {
              Alert.alert("Done", `${data} items suppressed.`);
              fetchAudit();
            }
          },
        },
      ]
    );
  }

  const suppressedCount = items.filter((i) => i.is_admin_suppressed).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Quality"
        right={
          tab === "audit" ? (
            <Pressable onPress={handleBulkSuppress} hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color={Colors.error} />
            </Pressable>
          ) : undefined
        }
      />

      {/* Tab toggle */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        {(["audit", "feedback"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: tab === t ? colors.text : colors.surfaceVariant,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: tab === t ? colors.background : colors.textSecondary,
              }}
            >
              {t === "audit" ? "Quality Audit" : "Feedback Review"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
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
            Failed to load
          </Text>
          <Text style={{ textAlign: "center", color: colors.textSecondary }}>
            {error}
          </Text>
          <Pressable
            onPress={tab === "audit" ? fetchAudit : fetchFeedback}
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
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 16,
            gap: 12,
          }}
        >
          {tab === "audit" ? (
            <>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                Top {items.length} items by tag count (most likely to appear in
                multiple cards). {suppressedCount} suppressed.
              </Text>
              {items.map((item) => (
                <AuditCard
                  key={item.id}
                  item={item}
                  onSuppress={() => handleSuppress(item.id, item.title)}
                  onUnsuppress={() => handleUnsuppress(item.id)}
                  colors={colors}
                />
              ))}
            </>
          ) : (
            <>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                {feedbackItems.length} items sorted by worst community feedback score.
              </Text>
              {feedbackItems.length === 0 && (
                <Text style={{ fontSize: 14, color: colors.textTertiary, textAlign: "center", paddingTop: 32 }}>
                  No feedback yet
                </Text>
              )}
              {feedbackItems.map((item) => (
                <FeedbackCard
                  key={item.explore_item_id}
                  item={item}
                  onSuppress={() => handleSuppress(item.explore_item_id, item.title)}
                  onUnsuppress={() => handleUnsuppress(item.explore_item_id)}
                  colors={colors}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
