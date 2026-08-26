// Post-first compose screen (Phase 3 · T5) — the crown-jewel picker.
// Reached after capture (app/post/camera.tsx). Two steps:
//   1. PICK: search_places_for_post (fuzzy, distance-ranked, 30km-capped) + a always-
//      present prominent "Post My Location". Select a place → verifyPostLocation (400m):
//      in range → link verified; out of range → BLOCK the link, degrade to My Location.
//   2. DETAILS: caption + Post (via src/lib/submitPost — same insert branching as check-in).
//
// docs/phase3_post_first.md §2 + §5b. "Posting never dead-ends": My Location is one tap
// from every state (empty search, no results, out of range).
//
// NOTE (judgment call, flagged for Kevin): the spec's separate "title" step has no
// posts.title column to persist to — the posts table only has `caption`. So title +
// caption are collapsed into the single caption field: a linked post shows the place
// name as context (its title comes from the explore_item_id join), a My-Location post
// uses the caption as its text. A distinct editable post title would need a new column.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/hooks/useAuth";
import { useToast } from "../../src/context/ToastContext";
import { useTheme } from "../../src/contexts/ThemeContext";
import { Colors } from "../../src/config/theme";
import { supabase } from "../../src/lib/supabase";
import { getCurrentLocation, verifyPostLocation } from "../../src/utils/location";
import { submitPost } from "../../src/lib/submitPost";
import { getPostDraft, clearPostDraft } from "../../src/utils/postDraftStore";
import { MAX_CAPTION_LENGTH } from "../../src/config/constants";
import { successHaptic, errorHaptic } from "../../src/utils/haptics";

type PlaceResult = {
  id: string;
  title: string;
  location_name: string | null;
  lat: number;
  lng: number;
  distance_m: number;
};

type Target =
  | { kind: "linked"; item: PlaceResult; lat: number; lng: number; at: string }
  | { kind: "mylocation"; lat: number; lng: number; at: string };

const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

function fmtDistance(m: number): string {
  const feet = m * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  return `${(m / 1609.34).toFixed(1)} mi`;
}

export default function PostCompose() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();

  const draft = useMemo(() => getPostDraft(), []);
  const previewUri = draft?.photos[draft.photos.length - 1];

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(true);

  const [step, setStep] = useState<"pick" | "details">("pick");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false); // a search has returned at least once
  const [blocked, setBlocked] = useState<{ place: PlaceResult; distance?: number } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [target, setTarget] = useState<Target | null>(null);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defensive: if we somehow landed here with no captured photo, go back.
  useEffect(() => {
    if (!draft || draft.photos.length === 0) {
      router.replace("/post/camera" as any);
    }
  }, [draft]);

  // Read GPS once on mount — needed for both search ranking and My Location.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loc = await getCurrentLocation();
      if (cancelled) return;
      if (loc.error || (loc.latitude === 0 && loc.longitude === 0)) {
        setLocError(loc.error || "We couldn&rsquo;t get your location");
      } else {
        setUserLoc({ lat: loc.latitude, lng: loc.longitude });
      }
      setLocLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      if (!userLoc || q.trim().length < MIN_QUERY) {
        setResults([]);
        setSearched(false);
        return;
      }
      setSearching(true);
      try {
        const { data, error } = await (supabase.rpc as any)("search_places_for_post", {
          p_query: q.trim(),
          p_lat: userLoc.lat,
          p_lng: userLoc.lng,
          p_limit: 12,
        });
        if (error) throw error;
        setResults(Array.isArray(data) ? (data as PlaceResult[]) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
        setSearched(true);
      }
    },
    [userLoc],
  );

  // Debounced search on query change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      setResults([]);
      setSearched(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Select a searched place → relaxed-radius verify.
  async function selectPlace(place: PlaceResult) {
    setBlocked(null);
    setVerifying(true);
    try {
      const res = await verifyPostLocation(place.lat, place.lng);
      if (res.allowed && res.user_lat != null && res.user_lng != null && res.verified_at) {
        setTarget({
          kind: "linked",
          item: place,
          lat: res.user_lat,
          lng: res.user_lng,
          at: res.verified_at,
        });
        setStep("details");
      } else {
        // Out of range (or GPS/permission issue) → block the link, offer My Location.
        setBlocked({ place, distance: res.distance });
      }
    } finally {
      setVerifying(false);
    }
  }

  // "Post My Location" — always available; real post-time coords, no place link.
  async function postMyLocation() {
    setVerifying(true);
    try {
      const loc = await getCurrentLocation();
      if (loc.error || (loc.latitude === 0 && loc.longitude === 0)) {
        errorHaptic();
        Alert.alert(
          "Location needed",
          "We couldn't read your location, which every post needs. Check that location is enabled for Euda and try again.",
        );
        return;
      }
      setTarget({
        kind: "mylocation",
        lat: loc.latitude,
        lng: loc.longitude,
        at: new Date().toISOString(),
      });
      setBlocked(null);
      setStep("details");
    } finally {
      setVerifying(false);
    }
  }

  async function post() {
    if (!user || !draft || !target) return;
    setPosting(true);
    try {
      const { error } = await submitPost({
        userId: user.id,
        photos: draft.photos,
        mode: draft.mode,
        caption,
        verifiedLat: target.lat,
        verifiedLng: target.lng,
        verifiedAt: target.at,
        exploreItemId: target.kind === "linked" ? target.item.id : null,
        itemKind: null,
      });
      if (error) {
        errorHaptic();
        showToast(error, "error");
        return;
      }
      clearPostDraft();
      successHaptic();
      showToast("Post created!", "success");
      setTimeout(() => router.replace("/(tabs)/feed" as any), 400);
    } finally {
      setPosting(false);
    }
  }

  // ---- render ----------------------------------------------------------------
  const headerBack = (
    <Pressable
      onPress={() => (step === "details" ? setStep("pick") : router.back())}
      accessibilityLabel="Back"
      accessibilityRole="button"
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={{ width: 40, height: 40, justifyContent: "center" }}
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );

  const myLocationButton = (
    <Pressable
      onPress={postMyLocation}
      disabled={verifying}
      accessibilityLabel="Post as My Location"
      accessibilityRole="button"
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 16,
        borderRadius: 12,
        backgroundColor: Colors.primary,
        opacity: verifying ? 0.6 : 1,
      }}
    >
      <Ionicons name="navigate" size={18} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Post My Location</Text>
    </Pressable>
  );

  if (step === "details") {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: Platform.OS === "ios" ? 56 : 16 }}>
          {headerBack}
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, marginLeft: 4 }}>Add details</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          {previewUri && (
            <Image source={{ uri: previewUri }} style={{ width: 120, height: 160, borderRadius: 12, alignSelf: "center", backgroundColor: colors.surfaceVariant }} resizeMode="cover" />
          )}

          {/* Where — the "title" context. Linked shows the place; My Location shows coords. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.surface }}>
            <Ionicons name={target?.kind === "linked" ? "location" : "navigate"} size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }} numberOfLines={1}>
                {target?.kind === "linked" ? target.item.title : "My Location"}
              </Text>
              {target?.kind === "linked" && !!target.item.location_name && (
                <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>{target.item.location_name}</Text>
              )}
              {target?.kind === "mylocation" && (
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>Posted with your current location</Text>
              )}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>Caption</Text>
              <Text style={{ fontSize: 13, color: colors.textTertiary }}>{caption.length}/{MAX_CAPTION_LENGTH}</Text>
            </View>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={target?.kind === "linked" ? "Say something about it…" : "What's happening here?"}
              placeholderTextColor={colors.textTertiary}
              maxLength={MAX_CAPTION_LENGTH}
              multiline
              accessibilityLabel="Caption"
              style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text, backgroundColor: colors.inputBg, minHeight: 80, textAlignVertical: "top" }}
            />
          </View>

          <Pressable
            onPress={post}
            disabled={posting}
            accessibilityLabel="Post"
            accessibilityRole="button"
            style={{ padding: 16, borderRadius: 12, backgroundColor: posting ? colors.textSecondary : Colors.primary, alignItems: "center", marginTop: 8 }}
          >
            {posting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Post</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // step === "pick"
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: Platform.OS === "ios" ? 56 : 16 }}>
        {headerBack}
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, marginLeft: 4 }}>Where are you?</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
        {/* Search field */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg }}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search for where you are"
            placeholderTextColor={colors.textTertiary}
            autoCorrect={false}
            accessibilityLabel="Search for a place"
            style={{ flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text }}
          />
          {searching && <ActivityIndicator size="small" color={colors.textSecondary} />}
          {!searching && query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>

        {/* Location status / GPS error */}
        {locLoading && (
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>Getting your location…</Text>
        )}
        {!locLoading && locError && (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.surface, gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>We couldn&rsquo;t get your location</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>Every post needs your location. Enable location for Euda in Settings, then reopen this screen.</Text>
          </View>
        )}

        {/* Out-of-range block (§5b) */}
        {blocked && (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: Colors.primary, gap: 8 }}>
            <Text style={{ fontSize: 14, color: colors.text }}>
              You&rsquo;re not close enough to tag{" "}
              <Text style={{ fontWeight: "700" }}>{blocked.place.title}</Text>
              {blocked.distance != null ? ` (${fmtDistance(blocked.distance)} away)` : ""} — post your location instead.
            </Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {/* Results */}
        {results.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => selectPlace(r)}
            disabled={verifying}
            accessibilityLabel={`Tag ${r.title}`}
            accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: verifying ? 0.5 : 1 }}
          >
            <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }} numberOfLines={1}>{r.title}</Text>
              {!!r.location_name && r.location_name !== r.title && (
                <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>{r.location_name}</Text>
              )}
            </View>
            <Text style={{ fontSize: 12, color: colors.textTertiary }}>{fmtDistance(r.distance_m)}</Text>
          </Pressable>
        ))}

        {/* Empty / not-found state (§5b) — never a dead end */}
        {searched && !searching && results.length === 0 && query.trim().length >= MIN_QUERY && (
          <View style={{ paddingVertical: 20, alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>Can&rsquo;t find it?</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}>No places match near you. You can still post as My Location.</Text>
          </View>
        )}

        {/* No-search / initial state prompt */}
        {query.trim().length < MIN_QUERY && !locError && (
          <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 12 }}>
            Search for a place you&rsquo;re at, or just post your location.
          </Text>
        )}
      </ScrollView>

      {/* My Location — persistent, prominent (never conditional). */}
      <View style={{ padding: 20, paddingBottom: Platform.OS === "ios" ? 34 : 20, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
        {verifying ? (
          <View style={{ padding: 16, alignItems: "center" }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          myLocationButton
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
