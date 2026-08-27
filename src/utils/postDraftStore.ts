// Ephemeral in-memory handoff for the post-first flow: the camera screen captures
// photo(s) + mode, then hands them to the compose screen (place-picker → details).
// Kept out of route params because photo URIs are long local file:// paths and dual
// mode carries two of them. Mirrors the locationPickerStore callback pattern.
import type { CameraMode } from "../config/constants";

/** When the flow was entered from a specific place (the unified item-gated route:
 *  event/postable-pin → strict check-in verify → camera → compose), the place is
 *  already known + verified. compose skips the picker and posts linked. */
export type PostDraftLink = {
  exploreItemId: string;
  title: string;
  locationName?: string | null;
  itemKind?: "event" | "activity" | null;
  // Coords from the strict check-in verify (verifyCheckInLocation), threaded through.
  lat: number;
  lng: number;
  at: string;
};

export type PostDraft = {
  photos: string[]; // [back] for single/front, [back, front] for dual
  mode: CameraMode;
  /** Present only for the item-gated route (pre-linked, pre-verified place). */
  linked?: PostDraftLink | null;
};

let draft: PostDraft | null = null;

export function setPostDraft(next: PostDraft): void {
  draft = next;
}

export function getPostDraft(): PostDraft | null {
  return draft;
}

export function clearPostDraft(): void {
  draft = null;
}
