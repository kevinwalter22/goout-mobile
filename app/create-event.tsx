import { useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";
import { useCreateEvent } from "../src/hooks/useCreateEvent";
import { AddressAutocomplete, type AddressSuggestion } from "../src/components/AddressAutocomplete";
import { setLocationPickerCallback } from "../src/utils/locationPickerStore";

export default function CreateEvent() {
  const insets = useSafeAreaInsets();
  const { colors, effectiveMode } = useTheme();
  const { createEvent, loading, error, clearError } = useCreateEvent();

  // Cover image
  const [imageUri, setImageUri] = useState<string | null>(null);

  function showImageOptions() {
    Alert.alert(
      "Cover Photo",
      undefined,
      [
        { text: "Take Photo", onPress: takePhoto },
        { text: "Choose from Library", onPress: pickFromLibrary },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Camera Permission Required",
        "Please enable camera access in Settings → Euda → Camera.",
        [{ text: "OK" }]
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 0.9,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.9,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [visibility, setVisibility] = useState<"friends_only" | "public">("friends_only");
  const [recurrence, setRecurrence] = useState<"none" | "weekly" | "monthly">("none");

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
      visibility,
      recurrence: recurrence !== "none" ? recurrence : undefined,
      imageUri: imageUri ?? undefined,
    });

    if (result) {
      const status = (result as any).review_status;
      if (status === "quarantined") {
        Alert.alert(
          "Pending Review",
          "Your event was created but is pending review. It will be visible to others once approved.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      } else {
        router.back();
      }
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
          Create Event
        </Text>
        <View style={{ minWidth: 80, alignItems: "flex-end" }}>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityLabel="Create event"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
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
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cover Photo */}
        <Pressable
          onPress={showImageOptions}
          accessibilityLabel={imageUri ? "Change cover photo" : "Add cover photo"}
          accessibilityRole="button"
          style={{
            height: 160,
            borderRadius: 12,
            overflow: "hidden",
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: imageUri ? "transparent" : colors.border,
            borderStyle: imageUri ? "solid" : "dashed",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {imageUri ? (
            <>
              <Image
                source={{ uri: imageUri }}
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                resizeMode="cover"
              />
              <View
                style={{
                  backgroundColor: "rgba(0,0,0,0.45)",
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="camera-outline" size={16} color="#fff" />
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Change Photo</Text>
              </View>
            </>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Ionicons name="image-outline" size={32} color={colors.textTertiary} />
              <Text style={{ fontSize: 14, color: colors.textTertiary }}>Add Cover Photo</Text>
            </View>
          )}
        </Pressable>

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
          <Pressable
            onPress={() => {
              setLocationPickerCallback(({ lat, lng }) => {
                setSelectedCoords({ lat, lng });
              });
              router.push({
                pathname: "/location-picker",
                params: {
                  lat: selectedCoords?.lat?.toString() ?? "",
                  lng: selectedCoords?.lng?.toString() ?? "",
                },
              } as any);
            }}
            accessibilityLabel="Drop pin on map"
            accessibilityRole="button"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
              paddingVertical: 6,
            }}
          >
            <Ionicons name="location-outline" size={16} color={Colors.primary} />
            <Text style={{ fontSize: 14, color: Colors.primary, fontWeight: "600" }}>
              {selectedCoords ? "Move pin" : "Drop pin on map"}
            </Text>
          </Pressable>
          {selectedCoords && (
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>
              Pin set: {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
            </Text>
          )}
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
