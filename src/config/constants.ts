// Check-in distance threshold in meters
// Must match POSTABLE_NOW_CONFIG.defaultRadius (0.124 miles ≈ 200m) in exploreFilters.ts
export const CHECK_IN_RADIUS_METERS = 200;

// Maximum caption length for posts
export const MAX_CAPTION_LENGTH = 100;

// Camera modes
export const CAMERA_MODES = {
  FRONT: "front",
  BACK: "back",
  DUAL: "dual",
} as const;

export type CameraMode = (typeof CAMERA_MODES)[keyof typeof CAMERA_MODES];

// Photo types for storage
export const PHOTO_TYPES = {
  FRONT: "front",
  BACK: "back",
  SINGLE: "single",
} as const;

export type PhotoType = (typeof PHOTO_TYPES)[keyof typeof PHOTO_TYPES];

// XP and Streak Progression
export const XP_REWARDS = {
  BASE_POST: 10,        // XP for any post
  EVENT_BONUS: 15,      // Additional XP if post is linked to an event
  ACTIVITY_BONUS: 5,    // Additional XP if post is linked to an activity (future feature)
} as const;

// Phone hash salt — loaded from env, must match server-side ALTER DATABASE setting
// See migration 072 for the server-side counterpart
import { Env } from "./env";
export const PHONE_HASH_SALT = Env.PHONE_HASH_SALT;
