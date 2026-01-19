// Check-in distance threshold in meters
export const CHECK_IN_RADIUS_METERS = 400;

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
