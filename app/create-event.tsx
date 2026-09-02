import { useRef, useState } from "react";
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
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTheme } from "../src/contexts/ThemeContext";
import { Colors } from "../src/config/theme";
import { useCreateEvent } from "../src/hooks/useCreateEvent";
import { markFeedDirty } from "../src/lib/feedRefresh";
import { useUnsavedChangesGuard } from "../src/hooks/useUnsavedChangesGuard";
import { AddressAutocomplete, type AddressSuggestion } from "../src/components/AddressAutocomplete";
import { setLocationPickerCallback } from "../src/utils/locationPickerStore";
import { MapPinComposite } from "../src/components/MapPinComposite";
import { uploadEventPinImage, setEventPinImageUrl } from "../src/lib/eventPin";

export default function CreateEvent() {
  const insets = useSafeAreaInsets();
  const { colors, effectiveMode } = useTheme();
  const { createEvent, loading, error, clearError } = useCreateEvent();

  // Cover image
  const [imageUri, setImageUri] = useState<string | null>(null);

  // Plan B: render + cache this user event's photo-bubble pin once at create time.
  const [pinPhotoUri, setPinPhotoUri] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const pinResolveRef = useRef<((uri: string | null) => void) | null>(null);

  function renderPinPng(photoUri: string): Promise<string | null> {
    return new Promise((resolve) => {
      pinResolveRef.current = resolve;
      setPinPhotoUri(photoUri); // mounts the hidden MapPinComposite → captures → resolves
    });
  }
  function handlePinCaptured(uri: string | null) {
    const resolve = pinResolveRef.current;
    pinResolveRef.current = null;
    setPinPhotoUri(null);
    resolve?.(uri);
  }

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

  const hasLocation = selectedCoords !== null || address.trim().length > 0;
  const canSubmit = title.trim().length > 0 && !loading && !finishing && hasLocation;

  const isDirty =
    title.trim().length > 0 ||
    description.trim().length > 0 ||
    locationName.trim().length > 0 ||
    address.trim().length > 0 ||
    selectedCoords !== null ||
    imageUri !== null ||
    endDate !== null ||
    recurrence !== "none" ||
    visibility !== "friends_only";
  const allowNextBack = useUnsavedChangesGuard(isDirty);

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
      // Plan B: composite + cache this event's photo-bubble pin (render-once). Best-effort —
      // a pin failure never blocks creation; the map shows the emoji fallback until rendered.
      if (imageUri) {
        setFinishing(true);
        try {
          const pngUri = await renderPinPng(imageUri);
          if (pngUri) {
            const url = await uploadEventPinImage(
              pngUri,
              (result as any).created_by_user_id,
              (result as any).id,
            );
            if (url) await setEventPinImageUrl((result as any).id, url);
          }
        } catch { /* pin is cosmetic */ }
        setFinishing(false);
      }
      const status = (result as any).review_status;
      if (status === "quarantined") {
        Alert.alert(
          "Pending Review",
          "Your event was created but is pending review. It will be visible to others once approved.",
          [{ text: "OK", onPress: () => { allowNextBack(); router.back(); } }],
        );
      } else {
        markFeedDirty(); // so the new event shows on the explore feed without a manual reload
        allowNextBack();
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
              {loading || finishing ? "Creating..." : "Create"}
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
            Address *
          </Text>
          <Text style={{ fontSize: 12, color: colors.textTertiary, marginTop: -4 }}>
            Required for map and check-in
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

      {/* Plan B: visible "creating your pin" overlay. MapPinComposite MUST render on-screen
          for react-native-view-shot to capture real pixels — an off-screen / opacity:0 view
          captures blank, which silently fails the composite. This also doubles as a signal
          that the Plan B bundle is running: if you see this overlay, the new code is live. */}
      {pinPhotoUri && (
        <View
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.45)",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 28,
              paddingHorizontal: 36,
              borderRadius: 20,
              alignItems: "center",
            }}
          >
            <MapPinComposite photoUri={pinPhotoUri} ringState="yours" onCapture={handlePinCaptured} />
            <Text style={{ marginTop: 14, color: colors.text, fontWeight: "600" }}>
              Creating your pin…
            </Text>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
