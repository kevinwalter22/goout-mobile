import { supabase } from "./supabase";

// Plan B photo-bubble pins (V1 = user-created events). Uploads the locally-composited
// circular pin PNG (from MapPinComposite / react-native-view-shot) to the public `posts`
// bucket and persists its URL on the event. Render-once / cache-forever: called once at
// create time; the map then reads explore_items.pin_image_url. PNG (not the .jpg-hardcoded
// uploadImage) so the transparent corners around the circular pin are preserved.

const BUCKET = "posts";

/** Upload the composited pin PNG; returns its public URL (or null on failure). */
export async function uploadEventPinImage(
  localUri: string,
  userId: string,
  eventId: string,
): Promise<string | null> {
  try {
    const res = await fetch(localUri);
    const bytes = await res.arrayBuffer();
    // MUST live under events/<userId>/ — the posts-bucket RLS INSERT policies only allow
    // writes where the first path segment is the caller's uid OR is 'events' with the uid
    // as the second segment (mig 075 + the events-folder policy). A bare event-pins/<id>.png
    // matches neither and is silently denied. Keep the pin beside the event's cover photo.
    const path = `events/${userId}/${eventId}-pin.png`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) {
      if (__DEV__) console.warn("[eventPin] upload failed:", error.message);
      return null;
    }
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    if (__DEV__) console.warn("[eventPin] upload exception:", e);
    return null;
  }
}

/** Persist the rendered pin URL on the event (best-effort; never throws). */
export async function setEventPinImageUrl(eventId: string, url: string): Promise<void> {
  const { error } = await supabase
    .from("explore_items")
    .update({ pin_image_url: url } as any)
    .eq("id", eventId);
  if (error && __DEV__) console.warn("[eventPin] set pin_image_url failed:", error.message);
}
