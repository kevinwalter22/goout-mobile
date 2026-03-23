import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { AddressAutocomplete, type AddressSuggestion } from "../../src/components/AddressAutocomplete";
import type { ExploreItem } from "../../src/types/database";
import { checkBeforeSubmit, moderateText } from "../../src/lib/moderation/textModeration";

/**
 * Geocode an address to get lat/lng coordinates
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const results = await Location.geocodeAsync(address);
    if (results.length > 0) {
      return {
        lat: results[0].latitude,
        lng: results[0].longitude,
      };
    }
    return null;
  } catch (error) {
    console.log("[geocodeAddress] Failed to geocode:", error);
    return null;
  }
}

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors, effectiveMode } = useTheme();

  const [item, setItem] = useState<ExploreItem | null>(null);
  const [loadingItem, setLoadingItem] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [visibility, setVisibility] = useState<"friends_only" | "public">("friends_only");
  const [recurrence, setRecurrence] = useState<"none" | "weekly" | "monthly">("none");

  // Date/time state
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Coordinates from address selection
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Handle address selection from autocomplete
  function handleAddressSelect(suggestion: AddressSuggestion) {
    setSelectedCoords({ lat: suggestion.lat, lng: suggestion.lng });
  }

  // Load the event data
  useEffect(() => {
    if (!id) return;

    async function loadEvent() {
      setLoadingItem(true);

      const { data, error: fetchError } = await supabase
        .from("explore_items")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError || !data) {
        setError("Event not found");
        setLoadingItem(false);
        return;
      }

      // Check if user owns this event
      if (data.created_by_user_id !== user?.id) {
        setError("You can only edit your own events");
        setLoadingItem(false);
        return;
      }

      setItem(data as ExploreItem);
      setTitle(data.title || "");
      setDescription(data.description || "");
      setLocationName(data.location_name || "");
      setAddress(data.address || "");
      setVisibility(data.visibility === "public" ? "public" : "friends_only");
      if (data.recurrence && ["weekly", "monthly"].includes(data.recurrence)) {
        setRecurrence(data.recurrence as "weekly" | "monthly");
      } else {
        setRecurrence("none");
      }
      if (data.starts_at) {
        setStartDate(new Date(data.starts_at));
      }
      if (data.ends_at) {
        setEndDate(new Date(data.ends_at));
      }

      setLoadingItem(false);
    }

    loadEvent();
  }, [id, user?.id]);

  const canSave = title.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave || !item) return;

    // Pre-submit moderation on title + description
    const titleCheck = checkBeforeSubmit(title.trim(), "event");
    if (!titleCheck.allowed) {
      Alert.alert("Can't save", titleCheck.reason);
      return;
    }
    if (description.trim()) {
      const descCheck = checkBeforeSubmit(description.trim(), "event");
      if (!descCheck.allowed) {
        Alert.alert("Can't save", descCheck.reason);
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const trimmedAddress = address.trim();

      // Use selected coords from autocomplete, or geocode if address changed
      let lat = selectedCoords?.lat ?? item.lat;
      let lng = selectedCoords?.lng ?? item.lng;
      const addressChanged = trimmedAddress !== (item.address || "");

      // If no coords from selection and address changed, try geocoding
      if (!selectedCoords && trimmedAddress && (addressChanged || lat === null || lng === null)) {
        const coords = await geocodeAddress(trimmedAddress);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      }

      // Determine review_status changes
      const updatePayload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        starts_at: startDate.toISOString(),
        ends_at: endDate?.toISOString() || null,
        location_name: locationName.trim() || null,
        address: trimmedAddress || null,
        lat,
        lng,
        visibility,
        recurrence: recurrence !== "none" ? recurrence : null,
      };

      // Re-quarantine if switching to public or if text moderation flags content
      const wasPublic = item.visibility === "public";
      const nowPublic = visibility === "public";
      const combinedText = [title.trim(), description.trim()].filter(Boolean).join(" ");
      const modResult = moderateText(combinedText, "event");

      if ((nowPublic && !wasPublic) || modResult.action === "quarantine") {
        updatePayload.review_status = "quarantined";
      }

      const { error: updateError } = await supabase
        .from("explore_items")
        .update(updatePayload)
        .eq("id", item.id)
        .eq("created_by_user_id", user?.id ?? "");

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (updatePayload.review_status === "quarantined") {
        Alert.alert(
          "Pending Review",
          "Your event has been updated and is pending review.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      } else {
        router.back();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save event";
      Alert.alert("Error", message);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  function formatDateTime(date: Date): string {
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (loadingItem) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (error || !item) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
          gap: 16,
        }}
      >
        <Ionicons name="alert-circle-outline" size={48} color={colors.textTertiary} />
        <Text style={{ fontSize: 16, color: colors.text, textAlign: "center" }}>
          {error || "Event not found"}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          style={{
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 8,
            backgroundColor: Colors.primary,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ gestureEnabled: false }} />
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 16,
          paddingTop: insets.top + 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ minWidth: 80 }}>
          <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Dismiss" accessibilityRole="button">
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, flex: 1, textAlign: "center" }}>
          Edit Event
        </Text>
        <View style={{ minWidth: 80, alignItems: "flex-end" }}>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            accessibilityLabel="Save event"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            style={{
              backgroundColor: canSave ? Colors.primary : colors.border,
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
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Title *
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Event name"
            placeholderTextColor={colors.textTertiary}
            maxLength={100}
            accessibilityLabel="Event title"
            style={{
              fontSize: 16,
              color: colors.text,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
            }}
          />
        </View>

        {/* Description */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Description
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Tell people what this event is about"
            placeholderTextColor={colors.textTertiary}
            maxLength={500}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            accessibilityLabel="Event description"
            style={{
              fontSize: 16,
              color: colors.text,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
              minHeight: 100,
            }}
          />
        </View>

        {/* Start Date/Time */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Start *
          </Text>
          <Pressable
            onPress={() => setShowStartPicker(true)}
            accessibilityLabel={`Start time: ${formatDateTime(startDate)}`}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 16, color: colors.text }}>
              {formatDateTime(startDate)}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          {showStartPicker && (
            <DateTimePicker
              value={startDate}
              mode="datetime"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant={effectiveMode === "dark" ? "dark" : "light"}
              onChange={(_, date) => {
                setShowStartPicker(Platform.OS === "ios");
                if (date) setStartDate(date);
              }}
            />
          )}
        </View>

        {/* End Date/Time (optional) */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            End (optional)
          </Text>
          <Pressable
            onPress={() => setShowEndPicker(true)}
            accessibilityLabel={endDate ? `End time: ${formatDateTime(endDate)}` : "Set end time"}
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                color: endDate ? colors.text : colors.textTertiary,
              }}
            >
              {endDate ? formatDateTime(endDate) : "Add end time"}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          {showEndPicker && (
            <DateTimePicker
              value={endDate || new Date(startDate.getTime() + 3600000)}
              mode="datetime"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant={effectiveMode === "dark" ? "dark" : "light"}
              onChange={(_, date) => {
                setShowEndPicker(Platform.OS === "ios");
                if (date) setEndDate(date);
              }}
              minimumDate={startDate}
            />
          )}
          {endDate && (
            <Pressable onPress={() => setEndDate(null)} accessibilityLabel="Remove end time" accessibilityRole="button">
              <Text style={{ fontSize: 14, color: Colors.primary }}>
                Remove end time
              </Text>
            </Pressable>
          )}
        </View>

        {/* Location Name */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Location Name
          </Text>
          <TextInput
            value={locationName}
            onChangeText={setLocationName}
            placeholder="e.g., Central Park, Joe's Cafe"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Location name"
            style={{
              fontSize: 16,
              color: colors.text,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 16,
            }}
          />
        </View>

        {/* Address */}
        <View style={{ gap: 8, zIndex: 10 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Address
          </Text>
          <AddressAutocomplete
            value={address}
            onChangeText={(text) => {
              setAddress(text);
              // Clear coords if user types manually (will geocode on save)
              setSelectedCoords(null);
            }}
            onSelectAddress={handleAddressSelect}
            placeholder="Search for an address..."
          />
        </View>

        {/* Repeats */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Repeats
          </Text>
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            {([
              { value: "none" as const, label: "Once" },
              { value: "weekly" as const, label: "Weekly" },
              { value: "monthly" as const, label: "Monthly" },
            ]).map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setRecurrence(option.value)}
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected: recurrence === option.value }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 12,
                  backgroundColor:
                    recurrence === option.value ? Colors.primary : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: "600",
                    color:
                      recurrence === option.value ? "#fff" : colors.textSecondary,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {recurrence === "weekly" && (
            <Text style={{ fontSize: 12, color: colors.textTertiary, paddingHorizontal: 4 }}>
              Repeats every {startDate.toLocaleDateString(undefined, { weekday: "long" })}
            </Text>
          )}
          {recurrence === "monthly" && (
            <Text style={{ fontSize: 12, color: colors.textTertiary, paddingHorizontal: 4 }}>
              Repeats monthly on the {startDate.getDate()}{startDate.getDate() > 3 && startDate.getDate() < 21 ? "th" : startDate.getDate() % 10 === 1 ? "st" : startDate.getDate() % 10 === 2 ? "nd" : startDate.getDate() % 10 === 3 ? "rd" : "th"}
            </Text>
          )}
        </View>

        {/* Visibility Toggle */}
        <View style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "600",
              color: colors.textSecondary,
            }}
          >
            Visibility
          </Text>
          <View
            style={{
              flexDirection: "row",
              backgroundColor: colors.surface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            <Pressable
              onPress={() => setVisibility("friends_only")}
              accessibilityLabel="Friends only"
              accessibilityRole="button"
              accessibilityState={{ selected: visibility === "friends_only" }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 12,
                backgroundColor:
                  visibility === "friends_only" ? Colors.primary : "transparent",
              }}
            >
              <Ionicons
                name="people"
                size={18}
                color={visibility === "friends_only" ? "#fff" : colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: visibility === "friends_only" ? "#fff" : colors.textSecondary,
                }}
              >
                Friends Only
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setVisibility("public")}
              accessibilityLabel="Public"
              accessibilityRole="button"
              accessibilityState={{ selected: visibility === "public" }}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 12,
                backgroundColor:
                  visibility === "public" ? Colors.primary : "transparent",
              }}
            >
              <Ionicons
                name="globe-outline"
                size={18}
                color={visibility === "public" ? "#fff" : colors.textSecondary}
              />
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: visibility === "public" ? "#fff" : colors.textSecondary,
                }}
              >
                Public
              </Text>
            </Pressable>
          </View>
          {visibility === "public" && (
            <Text style={{ fontSize: 12, color: colors.textTertiary, paddingHorizontal: 4 }}>
              Public events require approval before they appear to everyone.
            </Text>
          )}
        </View>

        {/* Bottom padding for scroll */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
