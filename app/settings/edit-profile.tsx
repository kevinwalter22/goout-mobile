import { useState, useEffect } from "react";
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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { captureError } from "../../src/lib/logger";
import { friendlyMessage } from "../../src/lib/errorMessages";
import { Avatar } from "../../src/components/Avatar";
import { checkBeforeSubmit } from "../../src/lib/moderation/textModeration";
import { requestImageModeration } from "../../src/utils/imageModeration";

export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, profile, refreshProfile } = useAuth();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (profile) {
      setUsername(profile.username || "");
      setBio(profile.bio || "");
      setAvatarUrl(profile.avatar_url);
    }
  }, [profile]);

  const canSave = username.trim().length >= 3 && !saving && !uploadingImage;

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Required", "Please allow access to your photo library.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadAvatar(result.assets[0].uri);
    }
  }

  async function uploadAvatar(uri: string) {
    if (!user) return;

    setUploadingImage(true);

    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const fileExt = uri.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${user.id}/avatar.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, blob, {
          upsert: true,
          contentType: `image/${fileExt}`,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(fileName);

      // Add cache buster
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setAvatarUrl(newUrl);

      // Update profile immediately
      await supabase
        .from("profiles")
        .update({ avatar_url: newUrl })
        .eq("id", user.id);

      // Fire-and-forget image moderation
      requestImageModeration({ bucket: "avatars", path: fileName });

    } catch (err) {
      captureError(err, { action: "uploadAvatar" });
      Alert.alert("Error", "Failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave() {
    if (!canSave || !user) return;

    // Check username
    const usernameCheck = checkBeforeSubmit(username.trim(), "username");
    if (!usernameCheck.allowed) {
      Alert.alert("Invalid username", usernameCheck.reason);
      return;
    }

    // Check bio
    if (bio.trim()) {
      const bioCheck = checkBeforeSubmit(bio.trim(), "bio");
      if (!bioCheck.allowed) {
        Alert.alert("Invalid bio", bioCheck.reason);
        return;
      }
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim(),
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq("id", user.id);

      if (error) throw error;

      await refreshProfile();
      router.back();
    } catch (err) {
      captureError(err, { action: "saveProfile" });
      Alert.alert("Error", friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  };

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
          Edit Profile
        </Text>
        <View style={{ minWidth: 80, alignItems: "flex-end" }}>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            accessibilityLabel="Save profile"
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
        contentContainerStyle={{ padding: 24, gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar */}
        <View style={{ alignItems: "center", gap: 12 }}>
          <View style={{ position: "relative" }}>
            <Avatar avatarUrl={avatarUrl} size={100} />
            {uploadingImage && (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  borderRadius: 50,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>
          <Pressable onPress={pickImage} disabled={uploadingImage} accessibilityLabel="Change profile photo" accessibilityRole="button" accessibilityState={{ disabled: uploadingImage }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: Colors.primary }}>
              Change Photo
            </Text>
          </Pressable>
        </View>

        {/* Username */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Username
          </Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Your username"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            accessibilityLabel="Username"
            style={inputStyle}
          />
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            3-30 characters, letters, numbers, and underscores only
          </Text>
        </View>

        {/* Bio */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Bio
          </Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about yourself..."
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={160}
            accessibilityLabel="Bio"
            style={[inputStyle, { minHeight: 100 }]}
          />
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            {bio.length}/160 characters
          </Text>
        </View>

        {/* Email (read-only) */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>
            Email
          </Text>
          <View
            style={[
              inputStyle,
              { backgroundColor: colors.surfaceVariant, flexDirection: "row", alignItems: "center", gap: 8 },
            ]}
          >
            <Ionicons name="lock-closed" size={16} color={colors.textTertiary} />
            <Text style={{ color: colors.textSecondary, flex: 1 }}>
              {user?.email || "Not set"}
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.textTertiary }}>
            Email cannot be changed
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
