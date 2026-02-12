import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";
import { useCreateEvent } from "../src/hooks/useCreateEvent";
import { AddressAutocomplete, type AddressSuggestion } from "../src/components/AddressAutocomplete";

export default function CreateEvent() {
  const insets = useSafeAreaInsets();
  const { colors, effectiveMode } = useTheme();
  const { createEvent, loading, error, clearError } = useCreateEvent();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Handle address selection from autocomplete
  function handleAddressSelect(suggestion: AddressSuggestion) {
    setSelectedCoords({ lat: suggestion.lat, lng: suggestion.lng });
  }

  // Date/time state
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const canSubmit = title.trim().length > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;

    clearError();

    const result = await createEvent({
      title: title.trim(),
      description: description.trim() || undefined,
      starts_at: startDate.toISOString(),
      ends_at: endDate?.toISOString(),
      location_name: locationName.trim() || undefined,
      address: address.trim() || undefined,
      lat: selectedCoords?.lat,
      lng: selectedCoords?.lng,
    });

    if (result) {
      router.back();
    } else if (error) {
      Alert.alert("Error", error);
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
          Create Event
        </Text>
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={{
            backgroundColor: canSubmit ? Colors.primary : colors.border,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {loading ? "Creating..." : "Create"}
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
              minimumDate={new Date()}
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
            This event will be visible only to you and your friends
          </Text>
        </View>

        {/* Bottom padding for scroll */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
