/**
 * Postable Now Utility
 *
 * Determines if an explore item is currently "postable" based on:
 * 1. User is within the allowed distance radius
 * 2. Current time is within the allowed time window
 *
 * Used to highlight items at the top of the Explore list.
 */

import type { ExploreItem, Availability } from "../types/database";
import { POSTABLE_NOW_CONFIG } from "../config/exploreFilters";
import { getDistanceInMiles } from "../utils/location";

// ============================================================================
// TYPES
// ============================================================================

export interface PostableNowResult {
  isPostable: boolean;
  reason: PostableReason;
  priority: number; // Lower = higher priority (for sorting)
  timeUntilStart?: number; // Minutes until event starts (negative if already started)
  distance?: number; // Miles from user
}

export type PostableReason =
  | "in_progress" // Event is happening now
  | "starting_soon" // Event starts within buffer window
  | "always_available" // Activity with no specific time
  | "nearby" // Within postable radius
  | "too_far" // Outside postable radius
  | "not_yet" // Event hasn't started
  | "ended" // Event has ended
  | "no_location" // Item has no coordinates
  | "unknown"; // Can't determine

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Compute whether an item is currently postable
 *
 * @param item - The explore item to check
 * @param userLocation - User's current location (optional)
 * @param now - Current time (defaults to new Date())
 * @param config - Override default config values
 */
export function computePostableNow(
  item: ExploreItem,
  userLocation?: { lat: number; lng: number } | null,
  now: Date = new Date(),
  config: Partial<typeof POSTABLE_NOW_CONFIG> = {}
): PostableNowResult {
  const {
    defaultRadius = POSTABLE_NOW_CONFIG.defaultRadius,
    preEventBuffer = POSTABLE_NOW_CONFIG.preEventBuffer,
  } = config;

  // Calculate distance if possible
  let distance: number | undefined;
  let isWithinRadius = true; // Default to true if no location

  if (userLocation && item.lat && item.lng) {
    distance = getDistanceInMiles(
      userLocation.lat,
      userLocation.lng,
      item.lat,
      item.lng
    );
    isWithinRadius = distance <= defaultRadius;
  } else if (!item.lat || !item.lng) {
    // No item coordinates - can't determine distance
    return {
      isPostable: false,
      reason: "no_location",
      priority: 999,
      distance: undefined,
    };
  }

  // If outside radius, not postable
  if (!isWithinRadius) {
    return {
      isPostable: false,
      reason: "too_far",
      priority: 999,
      distance,
    };
  }

  // Check time-based availability
  const timeResult = checkTimeAvailability(item, now, preEventBuffer);

  return {
    isPostable: timeResult.isAvailable && isWithinRadius,
    reason: timeResult.reason,
    priority: calculatePriority(timeResult, distance),
    timeUntilStart: timeResult.timeUntilStart,
    distance,
  };
}

// ============================================================================
// TIME AVAILABILITY CHECK
// ============================================================================

interface TimeCheckResult {
  isAvailable: boolean;
  reason: PostableReason;
  timeUntilStart?: number;
}

function checkTimeAvailability(
  item: ExploreItem,
  now: Date,
  preEventBuffer: number,
): TimeCheckResult {
  const nowMs = now.getTime();

  // Items with a concrete starts_at always use date-based logic (reliable source data).
  // availability_json from LLM enrichment is only used for activities without dates.
  if (item.starts_at) {
    const startTime = new Date(item.starts_at).getTime();
    const endTime = item.ends_at
      ? new Date(item.ends_at).getTime()
      : startTime + 3 * 60 * 60 * 1000; // Default 3 hours if no end time

    const preBufferMs = preEventBuffer * 60 * 1000;

    const timeUntilStart = Math.floor((startTime - nowMs) / (60 * 1000));

    // Event has ended — no longer postable, consistent with the detail page check
    if (nowMs > endTime) {
      return {
        isAvailable: false,
        reason: "ended",
        timeUntilStart,
      };
    }

    // Event is in progress
    if (nowMs >= startTime && nowMs <= endTime) {
      return {
        isAvailable: true,
        reason: "in_progress",
        timeUntilStart,
      };
    }

    // Event is starting soon (within pre-buffer)
    if (nowMs >= startTime - preBufferMs && nowMs < startTime) {
      return {
        isAvailable: true,
        reason: "starting_soon",
        timeUntilStart,
      };
    }

    // Event hasn't started yet
    return {
      isAvailable: false,
      reason: "not_yet",
      timeUntilStart,
    };
  }

  // No starts_at — use AI-enriched availability for activities
  if (item.availability_json) {
    return checkAvailabilityJson(item.availability_json, now);
  }

  // No specific time - check schedule_text hints
  if (item.schedule_text) {
    const scheduleHint = parseScheduleHint(item.schedule_text, now);
    if (scheduleHint !== null) {
      return {
        isAvailable: scheduleHint,
        reason: scheduleHint ? "always_available" : "not_yet",
      };
    }
  }

  // Activities without specific times are generally always postable
  if (item.kind === "activity") {
    return {
      isAvailable: true,
      reason: "always_available",
    };
  }

  return {
    isAvailable: false,
    reason: "unknown",
  };
}

/**
 * Check availability from AI-enriched availability_json
 */
function checkAvailabilityJson(
  availability: Availability,
  now: Date
): TimeCheckResult {
  // For events with next_occurrence
  if (availability.type === "event" && availability.next_occurrence) {
    const startTime = new Date(availability.next_occurrence).getTime();
    const nowMs = now.getTime();
    const timeUntilStart = Math.floor((startTime - nowMs) / (60 * 1000));

    // Within 2 hours before or after start
    if (Math.abs(timeUntilStart) <= 120) {
      return {
        isAvailable: true,
        reason: timeUntilStart > 0 ? "starting_soon" : "in_progress",
        timeUntilStart,
      };
    }

    return {
      isAvailable: false,
      reason: timeUntilStart > 0 ? "not_yet" : "ended",
      timeUntilStart,
    };
  }

  // For activities, check available_days and available_times
  if (availability.type === "activity") {
    const dayAvailable = checkDayAvailability(availability.available_days, now);
    const timeAvailable = checkTimeOfDayAvailability(availability.available_times, now);

    return {
      isAvailable: dayAvailable && timeAvailable,
      reason: dayAvailable && timeAvailable ? "always_available" : "not_yet",
    };
  }

  return {
    isAvailable: true,
    reason: "always_available",
  };
}

/**
 * Check if current day matches available_days
 */
function checkDayAvailability(
  availableDays: string[] | undefined,
  now: Date
): boolean {
  if (!availableDays || availableDays.length === 0) return true;
  if (availableDays.includes("daily")) return true;

  const dayMap = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayAbbrev = dayMap[now.getDay()];

  return availableDays.includes(todayAbbrev);
}

/**
 * Check if current time matches available_times
 */
function checkTimeOfDayAvailability(
  availableTimes: Availability["available_times"],
  now: Date
): boolean {
  if (!availableTimes || availableTimes === "anytime") return true;

  const hour = now.getHours();

  if (availableTimes === "daylight") {
    // Roughly 6am to 8pm
    return hour >= 6 && hour < 20;
  }

  if (typeof availableTimes === "object") {
    const startHour = parseInt(availableTimes.start.split(":")[0], 10);
    const endHour = parseInt(availableTimes.end.split(":")[0], 10);
    return hour >= startHour && hour < endHour;
  }

  return true;
}

/**
 * Parse schedule text for availability hints
 */
function parseScheduleHint(scheduleText: string, now: Date): boolean | null {
  const lower = scheduleText.toLowerCase();

  // Always available indicators
  if (
    lower.includes("daily") ||
    lower.includes("year-round") ||
    lower.includes("year round") ||
    lower.includes("24/7") ||
    lower.includes("anytime")
  ) {
    return true;
  }

  // Check for day-of-week mentions
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayName = dayNames[now.getDay()];

  if (lower.includes(todayName)) {
    return true;
  }

  // Check for "weekday" / "weekend"
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  if (lower.includes("weekend") && isWeekend) return true;
  if (lower.includes("weekday") && !isWeekend) return true;

  // Check for time-of-day mentions
  const hour = now.getHours();
  if (lower.includes("morning") && hour >= 6 && hour < 12) return true;
  if (lower.includes("afternoon") && hour >= 12 && hour < 17) return true;
  if (lower.includes("evening") && hour >= 17 && hour < 22) return true;
  if (lower.includes("night") && (hour >= 20 || hour < 4)) return true;

  // Seasonal checks
  const month = now.getMonth();
  const season = getSeason(month);
  if (lower.includes(season)) return true;

  return null; // Can't determine
}

function getSeason(month: number): string {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

// ============================================================================
// PRIORITY CALCULATION
// ============================================================================

function calculatePriority(
  timeResult: TimeCheckResult,
  distance?: number
): number {
  // Base priority by reason
  let priority = 50;

  switch (timeResult.reason) {
    case "in_progress":
      priority = 10;
      break;
    case "starting_soon":
      priority = 20 + Math.min(timeResult.timeUntilStart || 0, 60) / 10;
      break;
    case "always_available":
      priority = 30;
      break;
    case "nearby":
      priority = 40;
      break;
    default:
      priority = 100;
  }

  // Adjust by distance (closer = lower priority number = higher in list)
  if (distance !== undefined && distance < 5) {
    priority -= (5 - distance) * 2;
  }

  return Math.max(0, priority);
}

// ============================================================================
// LIST PROCESSING
// ============================================================================

export interface PostableNowItem extends ExploreItem {
  postableInfo: PostableNowResult;
}

/**
 * Process a list of items and separate into "postable now" and "other"
 */
export function processPostableNow(
  items: ExploreItem[],
  userLocation?: { lat: number; lng: number } | null,
  now: Date = new Date(),
  maxPostableItems: number = POSTABLE_NOW_CONFIG.maxItems
): {
  postableNow: PostableNowItem[];
  other: ExploreItem[];
} {
  const postableNow: PostableNowItem[] = [];
  const other: ExploreItem[] = [];

  for (const item of items) {
    const postableInfo = computePostableNow(item, userLocation, now);

    if (postableInfo.isPostable) {
      postableNow.push({ ...item, postableInfo });
    } else {
      other.push(item);
    }
  }

  // Sort postable items by priority
  postableNow.sort((a, b) => a.postableInfo.priority - b.postableInfo.priority);

  // Limit postable items
  const limitedPostable = postableNow.slice(0, maxPostableItems);
  const overflow = postableNow.slice(maxPostableItems);

  // Add overflow back to "other" list
  return {
    postableNow: limitedPostable,
    other: [...overflow.map((p) => ({ ...p, postableInfo: undefined } as ExploreItem)), ...other],
  };
}
