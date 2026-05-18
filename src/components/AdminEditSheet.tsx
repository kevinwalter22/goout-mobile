import { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../lib/supabase";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import type { ExploreItem } from "../types/database";

// ── Enum literals from schema (migrations 094, 097) ─────────────────────────
type AudienceFit = "youth_general" | "family" | "business" | "tourist" | "niche" | "unknown";
type Effort = "low" | "medium" | "high" | "unknown";
type Recurrence = "none" | "daily" | "weekly" | "monthly" | "annual";

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
const ALL_SEASONS = ["spring", "summer", "fall", "winter"] as const;
const AUDIENCE_OPTIONS: { value: AudienceFit; label: string }[] = [
  { value: "youth_general", label: "Young adults" },
  { value: "family", label: "Family" },
  { value: "business", label: "Business" },
  { value: "tourist", label: "Tourist" },
  { value: "niche", label: "Niche" },
  { value: "unknown", label: "Unknown" },
];
const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "unknown", label: "Unknown" },
];
const RECURRENCE_OPTIONS: Recurrence[] = ["none", "daily", "weekly", "monthly", "annual"];
const TIER_OPTIONS = [
  { value: 0, label: "Suppressed" },
  { value: 1, label: "Marginal" },
  { value: 2, label: "Standard" },
  { value: 3, label: "Premium" },
];

function timeToString(date: Date): string {
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
function stringToTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [hh, mm] = s.split(":");
  const d = new Date();
  d.setHours(parseInt(hh, 10), parseInt(mm, 10) || 0, 0, 0);
  return d;
}

type AdminEditSheetProps = {
  visible: boolean;
  onClose: () => void;
  item: ExploreItem;
  onSaved: () => void;
};

export function AdminEditSheet({ visible, onClose, item, onSaved }: AdminEditSheetProps) {
  const { colors, effectiveMode } = useTheme();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Always-visible state ─────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [hookLine, setHookLine] = useState("");
  const [category, setCategory] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [priceBucket, setPriceBucket] = useState<string>("unknown");
  const [scheduleText, setScheduleText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [audienceFit, setAudienceFit] = useState<AudienceFit>("unknown");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // ── Availability JSON sub-state ──────────────────────────────────────────
  const [availDays, setAvailDays] = useState<string[]>([]); // [] | ["daily"] | ["mon","tue",...]
  const [availTimesMode, setAvailTimesMode] = useState<"anytime" | "daylight" | "custom">("anytime");
  const [availStartTime, setAvailStartTime] = useState<Date | null>(null);
  const [availEndTime, setAvailEndTime] = useState<Date | null>(null);
  const [showAvailStartPicker, setShowAvailStartPicker] = useState(false);
  const [showAvailEndPicker, setShowAvailEndPicker] = useState(false);
  const [availSeasons, setAvailSeasons] = useState<string[]>([]); // [] | ["year_round"] | ["spring",...]

  // ── Advanced collapsible state ───────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [subCategory, setSubCategory] = useState("");
  const [timeText, setTimeText] = useState("");
  const [effort, setEffort] = useState<Effort>("unknown");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [isEventVenue, setIsEventVenue] = useState(false);
  const [isAnchor, setIsAnchor] = useState(false);
  const [isHiddenGem, setIsHiddenGem] = useState(false);
  const [relevanceTier, setRelevanceTier] = useState<number>(2);
  const [sourceUrl, setSourceUrl] = useState("");

  // ── Admin Controls (dangerous) ───────────────────────────────────────────
  const [isAdminSuppressed, setIsAdminSuppressed] = useState(false);
  const [adminSuppressedReason, setAdminSuppressedReason] = useState("");

  // ── Initialize form when item changes ────────────────────────────────────
  useEffect(() => {
    if (!item) return;

    setTitle(item.title || "");
    setDescription(item.description || "");
    setHookLine(item.hook_line || "");
    setCategory(item.category || "");
    setLocationName(item.location_name || "");
    setAddress(item.address || "");
    setTown(item.town || "");
    setPriceBucket(item.price_bucket || "unknown");
    setScheduleText(item.schedule_text || "");
    setImageUrl(item.image_url || "");
    setStartDate(item.starts_at ? new Date(item.starts_at) : null);
    setEndDate(item.ends_at ? new Date(item.ends_at) : null);
    setAudienceFit((item.audience_fit as AudienceFit) || "unknown");
    setTags(Array.isArray(item.tags) ? [...item.tags] : []);
    setTagInput("");

    // Availability JSON
    const av = (item.availability_json as any) || {};
    setAvailDays(Array.isArray(av.available_days) ? [...av.available_days] : []);
    if (!av.available_times || av.available_times === "anytime") {
      setAvailTimesMode("anytime");
      setAvailStartTime(null);
      setAvailEndTime(null);
    } else if (av.available_times === "daylight") {
      setAvailTimesMode("daylight");
      setAvailStartTime(null);
      setAvailEndTime(null);
    } else if (typeof av.available_times === "object") {
      setAvailTimesMode("custom");
      setAvailStartTime(stringToTime(av.available_times.start));
      setAvailEndTime(stringToTime(av.available_times.end));
    }
    setAvailSeasons(Array.isArray(av.available_seasons) ? [...av.available_seasons] : []);

    // Advanced
    setSubCategory(item.sub_category || "");
    setTimeText(item.time_text || "");
    setEffort((item.effort as Effort) || "unknown");
    setRecurrence((item.recurrence as Recurrence) || "none");
    setIsEventVenue(!!item.is_event_venue);
    setIsAnchor(!!item.is_anchor);
    setIsHiddenGem(!!item.is_hidden_gem);
    setRelevanceTier(typeof item.relevance_tier === "number" ? item.relevance_tier : 2);
    setSourceUrl(item.source_url || "");

    // Admin
    setIsAdminSuppressed(!!item.is_admin_suppressed);
    setAdminSuppressedReason(item.admin_suppressed_reason || "");
  }, [item]);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!title.trim()) {
      Alert.alert("Error", "Title is required");
      return;
    }
    if (isAdminSuppressed && !adminSuppressedReason.trim()) {
      Alert.alert("Error", "A reason is required when an item is admin-suppressed");
      return;
    }
    if (availTimesMode === "custom" && availStartTime && availEndTime && availStartTime >= availEndTime) {
      Alert.alert("Error", "Availability end time must be after start time");
      return;
    }

    setSaving(true);

    try {
      // Assemble availability_json. Preserve fields we don't expose in the
      // UI (next_occurrence, typical_duration, etc.) so we don't strip
      // enrichment metadata when an admin saves.
      const existingAv = (item.availability_json as any) || {};
      const availability: any = {
        type: item.kind === "event" ? "event" : "activity",
        recurrence,
        source: "manual",
      };
      if (availDays.length > 0) availability.available_days = availDays;
      if (availTimesMode === "anytime") availability.available_times = "anytime";
      else if (availTimesMode === "daylight") availability.available_times = "daylight";
      else if (availStartTime && availEndTime) {
        availability.available_times = {
          start: timeToString(availStartTime),
          end: timeToString(availEndTime),
        };
      }
      if (availSeasons.length > 0) availability.available_seasons = availSeasons;
      if (existingAv.next_occurrence) availability.next_occurrence = existingAv.next_occurrence;
      if (existingAv.typical_duration) availability.typical_duration = existingAv.typical_duration;
      if (existingAv.best_time_of_day) availability.best_time_of_day = existingAv.best_time_of_day;
      if (existingAv.confidence != null) availability.confidence = existingAv.confidence;

      const update: Record<string, any> = {
        title: title.trim(),
        description: description.trim() || null,
        hook_line: hookLine.trim() || null,
        category: category.trim() || null,
        sub_category: subCategory.trim() || null,
        location_name: locationName.trim() || null,
        address: address.trim() || null,
        town: town.trim() || null,
        starts_at: startDate?.toISOString() || null,
        ends_at: endDate?.toISOString() || null,
        schedule_text: scheduleText.trim() || null,
        time_text: timeText.trim() || null,
        price_bucket: priceBucket,
        effort: effort,
        recurrence,
        tags: tags.length > 0 ? tags : null,
        audience_fit: audienceFit,
        availability_json: availability,
        is_event_venue: isEventVenue,
        is_anchor: isAnchor,
        is_hidden_gem: isHiddenGem,
        relevance_tier: relevanceTier,
        image_url: imageUrl.trim() || null,
        source_url: sourceUrl.trim() || null,
        is_admin_suppressed: isAdminSuppressed,
        admin_suppressed_reason: isAdminSuppressed ? adminSuppressedReason.trim() : null,
      };

      const { error } = await supabase
        .from("explore_items")
        .update(update as any)
        .eq("id", item.id);

      if (error) throw error;

      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert(
      "Delete Item",
      "This will hide the item from all users. It can be restored later by an admin.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const { error } = await supabase
                .from("explore_items")
                .update({ deleted_at: new Date().toISOString() } as any)
                .eq("id", item.id);
              if (error) throw error;
              onSaved();
              onClose();
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to delete";
              Alert.alert("Error", message);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  // ── Tag helpers ──────────────────────────────────────────────────────────
  function addTag() {
    const cleaned = tagInput.trim().toLowerCase();
    if (!cleaned) return;
    if (tags.includes(cleaned)) {
      setTagInput("");
      return;
    }
    setTags([...tags, cleaned]);
    setTagInput("");
  }
  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  // ── Day / season toggles (mutually exclusive with their "all" sentinels) ─
  function toggleDay(day: string) {
    if (day === "daily") {
      setAvailDays(availDays.includes("daily") ? [] : ["daily"]);
      return;
    }
    // selecting any specific day clears "daily"
    const without = availDays.filter((d) => d !== "daily");
    setAvailDays(
      without.includes(day) ? without.filter((d) => d !== day) : [...without, day]
    );
  }
  function toggleSeason(season: string) {
    if (season === "year_round") {
      setAvailSeasons(availSeasons.includes("year_round") ? [] : ["year_round"]);
      return;
    }
    const without = availSeasons.filter((s) => s !== "year_round");
    setAvailSeasons(
      without.includes(season) ? without.filter((s) => s !== season) : [...without, season]
    );
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const inputStyle = {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
  };
  const labelStyle = {
    fontSize: 12,
    fontWeight: "600" as const,
    color: colors.textSecondary,
    marginBottom: 4,
  };
  const sectionHeaderStyle = {
    fontSize: 14,
    fontWeight: "700" as const,
    color: colors.text,
    marginTop: 8,
    marginBottom: 4,
  };

  function Chip({
    selected,
    onPress,
    label,
  }: {
    selected: boolean;
    onPress: () => void;
    label: string;
  }) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: selected ? Colors.primary : colors.surface,
          borderWidth: 1,
          borderColor: selected ? Colors.primary : colors.border,
        }}
      >
        <Text style={{ color: selected ? "#fff" : colors.text, fontWeight: "600", fontSize: 13 }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  function ReadOnlyRow({ label, value }: { label: string; value: any }) {
    return (
      <View style={{ flexDirection: "row", paddingVertical: 4 }}>
        <Text style={{ fontSize: 12, color: colors.textTertiary, width: 140 }}>{label}</Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1 }} selectable>
          {value == null || value === "" ? "—" : String(value)}
        </Text>
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 16,
            paddingTop: 60,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="shield-checkmark" size={16} color={Colors.primary} />
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
              Admin Edit
            </Text>
          </View>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={{
              backgroundColor: saving ? colors.border : Colors.primary,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "600" }}>
              {saving ? "Saving..." : "Save"}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ───────────────── ALWAYS VISIBLE ───────────────── */}

          {/* Title */}
          <View>
            <Text style={labelStyle}>TITLE *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Event/Activity title"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Hook Line */}
          <View>
            <Text style={labelStyle}>HOOK LINE</Text>
            <TextInput
              value={hookLine}
              onChangeText={setHookLine}
              placeholder="Short catchy description"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Description */}
          <View>
            <Text style={labelStyle}>DESCRIPTION</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Full description"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={[inputStyle, { minHeight: 100 }]}
            />
          </View>

          {/* Category */}
          <View>
            <Text style={labelStyle}>CATEGORY</Text>
            <TextInput
              value={category}
              onChangeText={setCategory}
              placeholder="e.g., sports, music, food"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Start Date */}
          <View>
            <Text style={labelStyle}>START DATE/TIME</Text>
            <Pressable
              onPress={() => setShowStartDatePicker(true)}
              style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            >
              <Text style={{ color: startDate ? colors.text : colors.textTertiary }}>
                {startDate
                  ? startDate.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : "No date set"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </Pressable>
            {showStartDatePicker && (
              <DateTimePicker
                value={startDate || new Date()}
                mode="datetime"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant={effectiveMode === "dark" ? "dark" : "light"}
                onChange={(_, date) => {
                  setShowStartDatePicker(Platform.OS === "ios");
                  if (date) setStartDate(date);
                }}
              />
            )}
            {startDate && (
              <Pressable onPress={() => setStartDate(null)} style={{ marginTop: 8 }}>
                <Text style={{ color: Colors.primary, fontSize: 14 }}>Clear date</Text>
              </Pressable>
            )}
          </View>

          {/* End Date */}
          <View>
            <Text style={labelStyle}>END DATE/TIME</Text>
            <Pressable
              onPress={() => setShowEndDatePicker(true)}
              style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            >
              <Text style={{ color: endDate ? colors.text : colors.textTertiary }}>
                {endDate
                  ? endDate.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : "No date set"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </Pressable>
            {showEndDatePicker && (
              <DateTimePicker
                value={endDate || startDate || new Date()}
                mode="datetime"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant={effectiveMode === "dark" ? "dark" : "light"}
                onChange={(_, date) => {
                  setShowEndDatePicker(Platform.OS === "ios");
                  if (date) setEndDate(date);
                }}
              />
            )}
            {endDate && (
              <Pressable onPress={() => setEndDate(null)} style={{ marginTop: 8 }}>
                <Text style={{ color: Colors.primary, fontSize: 14 }}>Clear date</Text>
              </Pressable>
            )}
          </View>

          {/* Schedule Text */}
          <View>
            <Text style={labelStyle}>SCHEDULE TEXT</Text>
            <TextInput
              value={scheduleText}
              onChangeText={setScheduleText}
              placeholder="e.g., Mon-Fri 9am-5pm"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Location Name */}
          <View>
            <Text style={labelStyle}>LOCATION NAME</Text>
            <TextInput
              value={locationName}
              onChangeText={setLocationName}
              placeholder="Venue or place name"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Address */}
          <View>
            <Text style={labelStyle}>ADDRESS</Text>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Street address"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Town */}
          <View>
            <Text style={labelStyle}>TOWN</Text>
            <TextInput
              value={town}
              onChangeText={setTown}
              placeholder="City/Town"
              placeholderTextColor={colors.textTertiary}
              style={inputStyle}
            />
          </View>

          {/* Image URL */}
          <View>
            <Text style={labelStyle}>IMAGE URL</Text>
            <TextInput
              value={imageUrl}
              onChangeText={setImageUrl}
              placeholder="https://..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              keyboardType="url"
              style={inputStyle}
            />
          </View>

          {/* Price Bucket */}
          <View>
            <Text style={labelStyle}>PRICE</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {["free", "$", "$$", "$$$", "unknown"].map((price) => (
                <Chip
                  key={price}
                  selected={priceBucket === price}
                  onPress={() => setPriceBucket(price)}
                  label={price === "unknown" ? "Unknown" : price === "free" ? "Free" : price}
                />
              ))}
            </View>
          </View>

          {/* Audience Fit */}
          <View>
            <Text style={labelStyle}>AUDIENCE FIT</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {AUDIENCE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  selected={audienceFit === opt.value}
                  onPress={() => setAudienceFit(opt.value)}
                  label={opt.label}
                />
              ))}
            </View>
          </View>

          {/* Tags */}
          <View>
            <Text style={labelStyle}>TAGS</Text>
            <Text style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 8 }}>
              Special tags affect categorization: indoors, outdoors, family_friendly, live_music, etc.
            </Text>
            {tags.length > 0 && (
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {tags.map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => removeTag(tag)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 14,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 12 }}>{tag}</Text>
                    <Ionicons name="close" size={14} color={colors.textSecondary} />
                  </Pressable>
                ))}
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={addTag}
                placeholder="Add tag (e.g., live_music)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                style={[inputStyle, { flex: 1 }]}
              />
              <Pressable
                onPress={addTag}
                style={{
                  backgroundColor: Colors.primary,
                  paddingHorizontal: 16,
                  justifyContent: "center",
                  borderRadius: 8,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "600" }}>Add</Text>
              </Pressable>
            </View>
          </View>

          {/* Availability JSON */}
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 12 }}>
            <Text style={sectionHeaderStyle}>AVAILABILITY</Text>

            <View>
              <Text style={labelStyle}>AVAILABLE DAYS</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Chip
                  selected={availDays.includes("daily")}
                  onPress={() => toggleDay("daily")}
                  label="Daily"
                />
                {ALL_DAYS.map((day) => (
                  <Chip
                    key={day}
                    selected={availDays.includes(day)}
                    onPress={() => toggleDay(day)}
                    label={DAY_LABELS[day]}
                  />
                ))}
              </View>
            </View>

            <View>
              <Text style={labelStyle}>AVAILABLE TIMES</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Chip selected={availTimesMode === "anytime"} onPress={() => setAvailTimesMode("anytime")} label="Anytime" />
                <Chip selected={availTimesMode === "daylight"} onPress={() => setAvailTimesMode("daylight")} label="Daylight" />
                <Chip selected={availTimesMode === "custom"} onPress={() => setAvailTimesMode("custom")} label="Custom" />
              </View>
              {availTimesMode === "custom" && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 4 }}>START</Text>
                    <Pressable
                      onPress={() => setShowAvailStartPicker(true)}
                      style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                    >
                      <Text style={{ color: availStartTime ? colors.text : colors.textTertiary }}>
                        {availStartTime ? timeToString(availStartTime) : "—"}
                      </Text>
                      <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                    {showAvailStartPicker && (
                      <DateTimePicker
                        value={availStartTime || new Date()}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={effectiveMode === "dark" ? "dark" : "light"}
                        onChange={(_, date) => {
                          setShowAvailStartPicker(Platform.OS === "ios");
                          if (date) setAvailStartTime(date);
                        }}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textTertiary, marginBottom: 4 }}>END</Text>
                    <Pressable
                      onPress={() => setShowAvailEndPicker(true)}
                      style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                    >
                      <Text style={{ color: availEndTime ? colors.text : colors.textTertiary }}>
                        {availEndTime ? timeToString(availEndTime) : "—"}
                      </Text>
                      <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                    </Pressable>
                    {showAvailEndPicker && (
                      <DateTimePicker
                        value={availEndTime || new Date()}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        themeVariant={effectiveMode === "dark" ? "dark" : "light"}
                        onChange={(_, date) => {
                          setShowAvailEndPicker(Platform.OS === "ios");
                          if (date) setAvailEndTime(date);
                        }}
                      />
                    )}
                  </View>
                </View>
              )}
            </View>

            <View>
              <Text style={labelStyle}>AVAILABLE SEASONS</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Chip
                  selected={availSeasons.includes("year_round")}
                  onPress={() => toggleSeason("year_round")}
                  label="Year-round"
                />
                {ALL_SEASONS.map((s) => (
                  <Chip
                    key={s}
                    selected={availSeasons.includes(s)}
                    onPress={() => toggleSeason(s)}
                    label={s.charAt(0).toUpperCase() + s.slice(1)}
                  />
                ))}
              </View>
            </View>
          </View>

          {/* ───────────────── ADVANCED COLLAPSIBLE ───────────────── */}
          <Pressable
            onPress={() => setShowAdvanced(!showAdvanced)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: 12,
              paddingHorizontal: 4,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              marginTop: 8,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.text }}>
              Advanced
            </Text>
            <Ionicons
              name={showAdvanced ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>

          {showAdvanced && (
            <View style={{ gap: 16 }}>
              <View>
                <Text style={labelStyle}>SUB-CATEGORY</Text>
                <TextInput
                  value={subCategory}
                  onChangeText={setSubCategory}
                  placeholder="e.g., bar, museum, hiking_trail"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  style={inputStyle}
                />
              </View>

              <View>
                <Text style={labelStyle}>TIME TEXT</Text>
                <TextInput
                  value={timeText}
                  onChangeText={setTimeText}
                  placeholder="Display string for time (e.g., 7pm doors)"
                  placeholderTextColor={colors.textTertiary}
                  style={inputStyle}
                />
              </View>

              <View>
                <Text style={labelStyle}>EFFORT</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {EFFORT_OPTIONS.map((opt) => (
                    <Chip key={opt.value} selected={effort === opt.value} onPress={() => setEffort(opt.value)} label={opt.label} />
                  ))}
                </View>
              </View>

              <View>
                <Text style={labelStyle}>RECURRENCE</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {RECURRENCE_OPTIONS.map((r) => (
                    <Chip
                      key={r}
                      selected={recurrence === r}
                      onPress={() => setRecurrence(r)}
                      label={r.charAt(0).toUpperCase() + r.slice(1)}
                    />
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontSize: 14 }}>Event venue (hosts events)</Text>
                <Switch value={isEventVenue} onValueChange={setIsEventVenue} />
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontSize: 14 }}>Anchor (curated highlight)</Text>
                <Switch value={isAnchor} onValueChange={setIsAnchor} />
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.text, fontSize: 14 }}>Hidden gem</Text>
                <Switch value={isHiddenGem} onValueChange={setIsHiddenGem} />
              </View>

              <View>
                <Text style={labelStyle}>RELEVANCE TIER</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {TIER_OPTIONS.map((t) => (
                    <Chip
                      key={t.value}
                      selected={relevanceTier === t.value}
                      onPress={() => setRelevanceTier(t.value)}
                      label={t.label}
                    />
                  ))}
                </View>
              </View>

              <View>
                <Text style={labelStyle}>SOURCE URL</Text>
                <TextInput
                  value={sourceUrl}
                  onChangeText={setSourceUrl}
                  placeholder="https://..."
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={inputStyle}
                />
              </View>
            </View>
          )}

          {/* ───────────────── ADMIN CONTROLS (DANGER) ───────────────── */}
          <View
            style={{
              marginTop: 24,
              borderWidth: 2,
              borderColor: Colors.error + "55",
              borderRadius: 12,
              padding: 16,
              backgroundColor: Colors.error + "08",
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="warning-outline" size={18} color={Colors.error} />
              <Text style={{ fontSize: 13, fontWeight: "700", color: Colors.error, letterSpacing: 0.5 }}>
                ADMIN CONTROLS
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>
                  Admin-suppress this item
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Hides the item from all users globally. Requires a reason.
                </Text>
              </View>
              <Switch
                value={isAdminSuppressed}
                onValueChange={setIsAdminSuppressed}
                trackColor={{ true: Colors.error, false: undefined }}
              />
            </View>

            {isAdminSuppressed && (
              <View>
                <Text style={[labelStyle, { color: Colors.error }]}>REASON (REQUIRED)</Text>
                <TextInput
                  value={adminSuppressedReason}
                  onChangeText={setAdminSuppressedReason}
                  placeholder="Why is this item being suppressed?"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  numberOfLines={2}
                  style={[inputStyle, { borderColor: Colors.error + "55", minHeight: 60 }]}
                  textAlignVertical="top"
                />
              </View>
            )}
          </View>

          {/* Delete Button */}
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            style={{
              marginTop: 8,
              padding: 16,
              borderRadius: 12,
              backgroundColor: Colors.error + "15",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {deleting ? (
              <ActivityIndicator color={Colors.error} size="small" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={20} color={Colors.error} />
                <Text style={{ color: Colors.error, fontWeight: "600", fontSize: 16 }}>
                  Delete Item
                </Text>
              </>
            )}
          </Pressable>

          {/* ───────────────── SYSTEM FIELDS (READ-ONLY) ───────────────── */}
          {/*
            These columns are intentionally read-only in this admin sheet:
            - kind:                  set at ingestion; changing breaks downstream logic
            - lat / lng:             computed by geocoder from address
            - xp_value, priority:    computed/system-managed by triggers
            - normalized_confidence: computed from provenance + source type
            - enrichment_version:    set by LLM enrichment pipeline
            - llm_enriched_at:       set by enrichment writer
            - created_by_user_id, visibility: only meaningful for user-created events
            - review_status, reviewed_*: handled by the admin review queue
                                          (app/settings/admin-review.tsx)
            - created_at, updated_at: system timestamps
          */}
          <View
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              gap: 2,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textTertiary, letterSpacing: 0.5, marginBottom: 8 }}>
              SYSTEM FIELDS (READ-ONLY)
            </Text>
            <ReadOnlyRow label="ID" value={item.id} />
            <ReadOnlyRow label="Kind" value={item.kind} />
            <ReadOnlyRow label="Lat / Lng" value={item.lat != null && item.lng != null ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}` : null} />
            <ReadOnlyRow label="XP value" value={item.xp_value} />
            <ReadOnlyRow label="Priority" value={item.priority} />
            <ReadOnlyRow label="Confidence" value={item.normalized_confidence} />
            <ReadOnlyRow label="Enrichment v." value={item.enrichment_version} />
            <ReadOnlyRow label="LLM enriched" value={item.llm_enriched_at} />
            <ReadOnlyRow label="Visibility" value={item.visibility} />
            <ReadOnlyRow label="Created by" value={item.created_by_user_id} />
            <ReadOnlyRow label="Review status" value={item.review_status} />
            <ReadOnlyRow label="Reviewed at" value={item.reviewed_at} />
            <ReadOnlyRow label="Source ID" value={item.source_id} />
            <ReadOnlyRow label="External ID" value={item.external_id} />
            <ReadOnlyRow label="Dedupe key" value={item.dedupe_key} />
            <ReadOnlyRow label="Is duplicate" value={item.is_duplicate ? "yes" : "no"} />
            <ReadOnlyRow label="Last refreshed" value={item.last_refreshed_at} />
            <ReadOnlyRow label="Stale reason" value={item.stale_reason} />
            <ReadOnlyRow label="Created at" value={item.created_at} />
            <ReadOnlyRow label="Updated at" value={item.updated_at} />
          </View>

          {/* Bottom padding */}
          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
