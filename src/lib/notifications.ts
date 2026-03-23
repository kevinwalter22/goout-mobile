import { Platform } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";
import { captureError } from "./logger";

// ── Lazy-load expo-notifications to avoid crashing in Expo Go ───
// The native module `ExpoPushTokenManager` only exists in dev builds / production.
let Notifications: typeof import("expo-notifications") | null = null;
try {
  Notifications = require("expo-notifications");
} catch {
  // Running in Expo Go — notifications unavailable
  if (__DEV__) {
    console.log("[Notifications] Native module not available (Expo Go). Push notifications disabled.");
  }
}

// ── Configure foreground notification behavior ──────────────
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// ── Stored token for cleanup on sign-out ────────────────────
let currentToken: string | null = null;

/**
 * Get the current push notification permission status without triggering a prompt.
 * Returns "granted", "denied", "undetermined", or null (web / module unavailable).
 */
export async function getPushPermissionStatus(): Promise<string | null> {
  if (Platform.OS === "web" || !Notifications) return null;
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Request push notification permissions and register the device
 * token with Supabase. Call once after the user signs in.
 */
export async function registerForPushNotifications(
  userId: string
): Promise<void> {
  // Push notifications are not supported on web or without native module
  if (Platform.OS === "web" || !Notifications) return;

  try {
    // Check current permission status
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not yet determined
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    // User denied — silently return
    if (finalStatus !== "granted") return;

    // Get the Expo push token
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId: "4c8f3119-7056-4a82-a35a-c0f05b161d8a",
    });
    const token = tokenResponse.data;
    currentToken = token;

    // Set up Android notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Upsert token to Supabase
    const platform = Platform.OS as "ios" | "android";
    await supabase.rpc("upsert_push_token", {
      p_user_id: userId,
      p_token: token,
      p_platform: platform,
    });
  } catch (error) {
    captureError(error, { action: "registerForPushNotifications" });
  }
}

/**
 * Remove the current device's push token from Supabase.
 * Call on sign-out.
 */
export async function removePushToken(userId: string): Promise<void> {
  if (!currentToken) return;

  try {
    await supabase.rpc("remove_push_token", {
      p_user_id: userId,
      p_token: currentToken,
    });
    currentToken = null;
  } catch (error) {
    captureError(error, { action: "removePushToken" });
  }
}

/**
 * Subscribe to notification tap events. Returns an unsubscribe function,
 * or null if notifications are unavailable.
 */
export function addNotificationResponseListener(
  callback: (response: any) => void
): (() => void) | null {
  if (!Notifications) return null;
  const sub = Notifications.addNotificationResponseReceivedListener(callback);
  return () => sub.remove();
}

/**
 * Handle a user tapping on a notification — deep-link to the
 * relevant screen.
 */
export function handleNotificationResponse(response: any): void {
  const data = response?.notification?.request?.content?.data;
  if (!data?.type) return;

  switch (data.type) {
    case "friend_request":
      // Navigate to profile tab (shows friend requests badge)
      router.push("/(tabs)/profile");
      break;
    case "friend_accepted":
      // Navigate to the user who accepted
      if (data.reference_id) {
        router.push(`/user/${data.reference_id}` as any);
      }
      break;
    case "event_reminder":
      // Navigate to the event
      if (data.reference_id) {
        router.push(`/event/${data.reference_id}` as any);
      }
      break;
  }
}
