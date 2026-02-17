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
import { router, useLocalSearchParams } from "expo-router";
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

      const { error: updateError } = await supabase
        .from("explore_items")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          starts_at: startDate.toISOString(),
          ends_at: endDate?.toISOString() || null,
          location_name: locationName.trim() || null,
          address: trimmedAddress || null,
          lat,
          lng,
        })
        .eq("id", item.id)
        .eq("created_by_user_id", user?.id ?? "");

      if (updateError) {
        throw new Error(updateError.message);
      }

      router.back();
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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Edit Event
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
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
            <Pressable onPress={() => setEndDate(null)}>
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

        {/* Visibility Info */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: colors.surface,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <Ionicons name="people" size={20} color={Colors.primary} />
          <Text style={{ fontSize: 14, color: colors.textSecondary, flex: 1 }}>
            This event is visible only to you and your friends
          </Text>
        </View>

        {/* Bottom padding for scroll */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
