import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Colors } from "../../src/config/theme";
import { useTheme } from "../../src/contexts/ThemeContext";
import { supabase } from "../../src/lib/supabase";

// ============================================================================
// Types
// ============================================================================

interface VenueCandidate {
  id: string;
  place_name: string;
  website_url: string;
  town: string | null;
  place_type: string | null;
  event_score: number;
  discovery_status: string;
  detected_strategy: string | null;
  event_signal_keywords: string[] | null;
  detected_event_urls: string[] | null;
  evaluated_at: string | null;
  collector_target_id: string | null;
  // joined from collector_targets
  target_enabled?: boolean | null;
  target_name?: string | null;
}

// ============================================================================
// Sub-components
// ============================================================================

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const color =
    strategy === "ics" ? Colors.success
    : strategy === "jsonld" ? "#6366f1"
    : strategy === "rss" ? "#f59e0b"
    : "#888";

  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "700", color, textTransform: "uppercase" }}>
        {strategy}
      </Text>
    </View>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? Colors.success : score >= 50 ? Colors.warning : Colors.error;
  return (
    <View
      style={{
        backgroundColor: color + "20",
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "700", color }}>{score}</Text>
    </View>
  );
}

function CandidateCard({
  item,
  onEnable,
  onDisable,
  colors,
}: {
  item: VenueCandidate;
  onEnable: () => void;
  onDisable: () => void;
  colors: any;
}) {
  const isEnabled = item.target_enabled === true;
  const hasTarget = item.collector_target_id != null;

  return (
    <View
      style={{
        borderRadius: 12,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 16,
        gap: 8,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.text }}>
          {item.place_name}
        </Text>
        <ScoreBadge score={item.event_score} />
        <StrategyBadge strategy={item.detected_strategy} />
      </View>

      {/* Location + type */}
      {(item.town || item.place_type) && (
        <Text style={{ fontSize: 12, color: colors.textSecondary }}>
          {[item.town, item.place_type].filter(Boolean).join(" · ")}
        </Text>
      )}

      {/* Website URL */}
      <Pressable onPress={() => Linking.openURL(item.website_url)}>
        <Text style={{ fontSize: 12, color: Colors.primary }} numberOfLines={1}>
          {item.website_url}
        </Text>
      </Pressable>

      {/* Keywords */}
      {item.event_signal_keywords && item.event_signal_keywords.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {item.event_signal_keywords.slice(0, 6).map((kw) => (
            <View
              key={kw}
              style={{
                backgroundColor: colors.border,
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ fontSize: 11, color: colors.textSecondary }}>{kw}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Event URLs */}
      {item.detected_event_urls && item.detected_event_urls.length > 0 && (
        <Text style={{ fontSize: 11, color: colors.textTertiary }} numberOfLines={2}>
          Pages: {item.detected_event_urls.join(", ")}
        </Text>
      )}

      {/* Collector target status */}
      {hasTarget && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons
            name={isEnabled ? "checkmark-circle" : "pause-circle-outline"}
            size={14}
            color={isEnabled ? Colors.success : colors.textSecondary}
          />
          <Text style={{ fontSize: 12, color: isEnabled ? Colors.success : colors.textSecondary }}>
            {isEnabled ? "Crawling enabled" : "Awaiting review"}
          </Text>
        </View>
      )}

      {/* Action buttons */}
      {hasTarget && (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
          <Pressable
            onPress={onEnable}
            disabled={isEnabled}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: isEnabled ? colors.border : Colors.success + "18",
              opacity: isEnabled ? 0.5 : 1,
            }}
          >
            <Ionicons name="play-circle-outline" size={16} color={Colors.success} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: Colors.success }}>Enable</Text>
          </Pressable>

          <Pressable
            onPress={onDisable}
            disabled={!isEnabled}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: !isEnabled ? colors.border : Colors.error + "18",
              opacity: !isEnabled ? 0.5 : 1,
            }}
          >
            <Ionicons name="pause-circle-outline" size={16} color={Colors.error} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: Colors.error }}>Pause</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Main screen
// ============================================================================

export default function AdminTargets() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<VenueCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"has_events" | "added_as_target" | "all">("has_events");

  const fetchCandidates = useCallback(async () => {
    const statusValues =
      statusFilter === "all"
        ? ["has_events", "added_as_target"]
        : [statusFilter];

    const { data, error } = await (supabase as any)
      .from("venue_website_candidates")
      .select(`
        id, place_name, website_url, town, place_type, event_score,
        discovery_status, detected_strategy, event_signal_keywords,
        detected_event_urls, evaluated_at, collector_target_id
      `)
      .in("discovery_status", statusValues)
      .order("event_score", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Failed to fetch venue candidates:", error);
      return;
    }

    if (!data || data.length === 0) {
      setItems([]);
      return;
    }

    // Enrich with collector_target enabled status
    const targetIds = (data as VenueCandidate[])
      .map((d) => d.collector_target_id)
      .filter(Boolean) as string[];

    let targetMap: Record<string, { is_enabled: boolean; name: string }> = {};
    if (targetIds.length > 0) {
      const { data: targets } = await supabase
        .from("collector_targets")
        .select("id, is_enabled, name")
        .in("id", targetIds);

      for (const t of targets || []) {
        targetMap[t.id] = { is_enabled: t.is_enabled, name: t.name };
      }
    }

    setItems(
      (data as VenueCandidate[]).map((d) => ({
        ...d,
        target_enabled: d.collector_target_id ? targetMap[d.collector_target_id]?.is_enabled ?? null : null,
        target_name: d.collector_target_id ? targetMap[d.collector_target_id]?.name ?? null : null,
      })),
    );
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchCandidates().finally(() => setLoading(false));
  }, [fetchCandidates]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchCandidates();
    setRefreshing(false);
  }

  async function setTargetEnabled(item: VenueCandidate, enabled: boolean) {
    if (!item.collector_target_id) return;
    const { error } = await supabase
      .from("collector_targets")
      .update({ is_enabled: enabled })
      .eq("id", item.collector_target_id);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, target_enabled: enabled } : i,
      ),
    );
  }

  function handleEnable(item: VenueCandidate) {
    Alert.alert(
      "Enable Crawling",
      `Start crawling "${item.place_name}"? The collector will fetch up to 20 pages every 12 hours.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Enable", onPress: () => setTargetEnabled(item, true) },
      ],
    );
  }

  function handleDisable(item: VenueCandidate) {
    Alert.alert(
      "Pause Crawling",
      `Stop crawling "${item.place_name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pause", style: "destructive", onPress: () => setTargetEnabled(item, false) },
      ],
    );
  }

  const filterTabs: { label: string; value: typeof statusFilter }[] = [
    { label: "Pending Review", value: "has_events" },
    { label: "Active", value: "added_as_target" },
    { label: "All", value: "all" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Venue Discovery" />

      {/* Filter tabs */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingVertical: 10,
          gap: 8,
        }}
      >
        {filterTabs.map((tab) => (
          <Pressable
            key={tab.value}
            onPress={() => setStatusFilter(tab.value)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 20,
              backgroundColor:
                statusFilter === tab.value ? Colors.primary : colors.surface,
              borderWidth: 1,
              borderColor:
                statusFilter === tab.value ? Colors.primary : colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: statusFilter === tab.value ? "#fff" : colors.textSecondary,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            paddingBottom: insets.bottom + 24,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {items.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
              <Ionicons name="globe-outline" size={48} color={colors.textTertiary} />
              <Text style={{ fontSize: 16, color: colors.textSecondary, textAlign: "center" }}>
                {statusFilter === "has_events"
                  ? "No venues awaiting review.\nRun evaluate-venue-websites to discover new ones."
                  : "No venues found."}
              </Text>
            </View>
          ) : (
            items.map((item) => (
              <CandidateCard
                key={item.id}
                item={item}
                onEnable={() => handleEnable(item)}
                onDisable={() => handleDisable(item)}
                colors={colors}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
