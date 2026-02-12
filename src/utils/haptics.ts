import * as Haptics from "expo-haptics";

/**
 * Lightweight haptic feedback (for reactions, taps)
 */
export function lightHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Medium haptic feedback (for RSVP, friend add/remove)
 */
export function mediumHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/**
 * Heavy haptic feedback (for photo capture, destructive actions)
 */
export function heavyHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

/**
 * Success notification haptic
 */
export function successHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

/**
 * Error notification haptic
 */
export function errorHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

/**
 * Selection haptic (for navigation, tabs)
 */
export function selectionHaptic() {
  Haptics.selectionAsync();
}

/**
 * Trigger haptic by type name
 */
export function triggerHaptic(type: "light" | "medium" | "heavy" | "success" | "error" | "selection" = "light") {
  switch (type) {
    case "light":
      lightHaptic();
      break;
    case "medium":
      mediumHaptic();
      break;
    case "heavy":
      heavyHaptic();
      break;
    case "success":
      successHaptic();
      break;
    case "error":
      errorHaptic();
      break;
    case "selection":
      selectionHaptic();
      break;
  }
}
