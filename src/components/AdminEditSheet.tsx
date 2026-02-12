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

  // Form state
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
  const [isHidden, setIsHidden] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Initialize form when item changes
  useEffect(() => {
    if (item) {
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
      setIsHidden(false); // We'd need a column for this
      setStartDate(item.starts_at ? new Date(item.starts_at) : null);
    }
  }, [item]);

  async function handleSave() {
    if (!title.trim()) {
      Alert.alert("Error", "Title is required");
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from("explore_items")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          hook_line: hookLine.trim() || null,
          category: category.trim() || null,
          location_name: locationName.trim() || null,
          address: address.trim() || null,
          town: town.trim() || null,
          price_bucket: priceBucket as any,
          schedule_text: scheduleText.trim() || null,
          image_url: imageUrl.trim() || null,
          starts_at: startDate?.toISOString() || null,
        })
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
              // Soft delete — sets deleted_at, trigger auto-logs audit entry
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
              onPress={() => setShowDatePicker(true)}
              style={[inputStyle, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
            >
              <Text style={{ color: startDate ? colors.text : colors.textTertiary }}>
                {startDate
                  ? startDate.toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "No date set"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={startDate || new Date()}
                mode="datetime"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant={effectiveMode === "dark" ? "dark" : "light"}
                onChange={(_, date) => {
                  setShowDatePicker(Platform.OS === "ios");
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

          {/* Price Bucket */}
          <View>
            <Text style={labelStyle}>PRICE</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {["free", "$", "$$", "$$$", "unknown"].map((price) => (
                <Pressable
                  key={price}
                  onPress={() => setPriceBucket(price)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderRadius: 20,
                    backgroundColor: priceBucket === price ? Colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: priceBucket === price ? Colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: priceBucket === price ? "#fff" : colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {price === "unknown" ? "Unknown" : price === "free" ? "Free" : price}
                  </Text>
                </Pressable>
              ))}
            </View>
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

          {/* Delete Button */}
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            style={{
              marginTop: 16,
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

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
