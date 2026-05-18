import { Platform } from "react-native";
import { router } from "expo-router";
import { supabase } from "./supabase";
import { captureError, captureWarning } from "./logger";
import { appEvents } from "../utils/appEvents";

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

    // Get the Expo push token — retry once on transient failures (503 / timeout)
    // since Expo's token service has occasional brief outages that should not
    // generate Sentry alerts.
    let tokenResponse;
    try {
      tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId: "4c8f3119-7056-4a82-a35a-c0f05b161d8a",
      });
    } catch (firstErr) {
      const msg = (firstErr instanceof Error ? firstErr.message : String(firstErr)).toLowerCase();
      const isTransient =
        msg.includes("timeout") ||
        msg.includes("503") ||
        msg.includes("service unavailable") ||
        msg.includes("network request failed");

      if (!isTransient) {
        captureError(firstErr, { action: "registerForPushNotifications" });
        return;
      }

      // One retry after a short pause
      await new Promise((r) => setTimeout(r, 3000));
      try {
        tokenResponse = await Notifications.getExpoPushTokenAsync({
          projectId: "4c8f3119-7056-4a82-a35a-c0f05b161d8a",
        });
      } catch (retryErr) {
        captureWarning("Push token fetch failed after retry (transient)", {
          action: "registerForPushNotifications",
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        return;
      }
    }
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

    // Upsert token to Supabase — retry once on failure since the token
    // is already obtained and the only thing left is persisting it.
    const platform = Platform.OS as "ios" | "android";
    const upsertArgs = { p_user_id: userId, p_token: token, p_platform: platform };
    let { error: rpcError } = await supabase.rpc("upsert_push_token", upsertArgs);

    if (rpcError) {
      // One retry after a short pause — covers transient DB/network blips
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await supabase.rpc("upsert_push_token", upsertArgs);
      rpcError = retry.error;
    }

    if (rpcError) {
      captureError(rpcError, { action: "upsert_push_token", retried: true });
      return;
    }

    if (__DEV__) {
      console.log("[Notifications] Push token registered:", token.slice(0, 20) + "...");
    }
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
 * Subscribe to foreground notification arrivals (banner shown while app is
 * open). Returns an unsubscribe function, or null if notifications are
 * unavailable.
 */
export function addNotificationReceivedListener(
  callback: (notification: any) => void
): (() => void) | null {
  if (!Notifications) return null;
  const sub = Notifications.addNotificationReceivedListener(callback);
  return () => sub.remove();
}

/**
 * Emit app-event signals for notification data so already-mounted hooks
 * (e.g. useFriendRequests on the Profile tab) can invalidate their data.
 * Shared by the tap-response and foreground-received handlers.
 */
function emitDataEventForNotification(data: any): void {
  if (!data?.type) return;
  switch (data.type) {
    case "friend_request":
      appEvents.emit("notification:friendRequest", {});
      break;
    case "friend_accepted":
      appEvents.emit("notification:friendAccepted", { accepterId: data.reference_id });
      break;
  }
}

/**
 * Handle a user tapping on a notification — deep-link to the relevant
 * screen AND emit a data-refresh event so the destination screen's hooks
 * pick up the new state even if they're already mounted.
 */
export function handleNotificationResponse(response: any): void {
  const data = response?.notification?.request?.content?.data;
  if (!data?.type) return;

  emitDataEventForNotification(data);

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
    case "post_reaction":
    case "post_comment":
      // Navigate to the feed where the post is visible
      router.push("/(tabs)/feed");
      break;
  }
}

/**
 * Handle a foreground notification arrival — no navigation, but still emit
 * data-refresh events so badges/indicators update immediately while the user
 * stays on their current screen.
 */
export function handleNotificationReceivedForeground(notification: any): void {
  const data = notification?.request?.content?.data;
  emitDataEventForNotification(data);
}
