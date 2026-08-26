// Ephemeral in-memory handoff for the post-first flow: the camera screen captures
// photo(s) + mode, then hands them to the compose screen (place-picker → details).
// Kept out of route params because photo URIs are long local file:// paths and dual
// mode carries two of them. Mirrors the locationPickerStore callback pattern.
import type { CameraMode } from "../config/constants";

export type PostDraft = {
  photos: string[]; // [back] for single/front, [back, front] for dual
  mode: CameraMode;
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
