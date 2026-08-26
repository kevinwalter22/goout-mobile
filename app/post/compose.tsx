// Post-first compose screen (Phase 3 · T5) — the crown-jewel picker.
// Reached after capture (app/post/camera.tsx). Two steps:
//   1. PICK: nearby places on open (tap to link, no typing) + search_places_for_post
//      (fuzzy, distance-ranked, 30km-capped) + an always-present "Post My Location".
//      Select a place → verifyPostLocation (400m): in range → link verified; out of
//      range → BLOCK the link, degrade to My Location.
//   2. DETAILS: caption + Post (via src/lib/submitPost — same insert branching as check-in).
//
// UNIFIED: the traditional item-gated route (event / postable pin → strict check-in
// verify) now enters HERE too, pre-linked (draft.linked) — so there is ONE camera +
// ONE post screen regardless of how you started. A pre-linked draft skips the picker.
//
// Top spacing uses the safe-area inset (app convention: insets.top + margin) so the
// header clears the notch/Dynamic Island in prod AND the staging env banner in staging.
//
// NOTE: posts has no title column — title + caption collapse into caption; a linked
// post shows the place name as context (its title comes from the explore_item_id join).
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { DualCameraPost } from "../../src/components/DualCameraPost";

type PlaceResult = {
  id: string;
  title: string;
  location_name: string | null;
  lat: number;
  lng: number;
  distance_m: number;
};

type Target =
  | { kind: "linked"; item: { id: string; title: string; location_name: string | null }; itemKind?: "event" | "activity" | null; lat: number; lng: number; at: string }
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
  const insets = useSafeAreaInsets();

  const draft = useMemo(() => getPostDraft(), []);
  const previewUri = draft?.photos[draft.photos.length - 1];
  // Item-gated: the place is already linked + verified → skip the picker.
  const preLinked = draft?.linked ?? null;

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(true);

  const [step, setStep] = useState<"pick" | "details">(preLinked ? "details" : "pick");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [nearby, setNearby] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [blocked, setBlocked] = useState<{ place: PlaceResult; distance?: number } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [target, setTarget] = useState<Target | null>(
    preLinked
      ? {
          kind: "linked",
          item: { id: preLinked.exploreItemId, title: preLinked.title, location_name: preLinked.locationName ?? null },
          itemKind: preLinked.itemKind ?? null,
          lat: preLinked.lat,
          lng: preLinked.lng,
          at: preLinked.at,
        }
      : null,
  );
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Defensive: if we somehow landed here with no captured photo, go back.
  useEffect(() => {
    if (!draft || draft.photos.length === 0) {
      router.replace("/post/camera" as any);
    }
  }, [draft]);

  // Read GPS once on mount, then fetch NEARBY places (empty query = distance-ranked)
  // so the picker shows tappable spots immediately, no typing. Skipped when pre-linked.
  useEffect(() => {
    if (preLinked) {
      setLocLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const loc = await getCurrentLocation();
      if (cancelled) return;
      if (loc.error || (loc.latitude === 0 && loc.longitude === 0)) {
        setLocError(loc.error || "We couldn't get your location");
        setLocLoading(false);
        return;
      }
      setUserLoc({ lat: loc.latitude, lng: loc.longitude });
      setLocLoading(false);
      try {
        const { data } = await (supabase.rpc as any)("search_places_for_post", {
          p_query: "",
          p_lat: loc.latitude,
          p_lng: loc.longitude,
          p_limit: 12,
        });
        if (!cancelled && Array.isArray(data)) setNearby(data as PlaceResult[]);
      } catch {
        /* nearby is a convenience; search still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preLinked]);

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

  async function selectPlace(place: PlaceResult) {
    setBlocked(null);
    setVerifying(true);
    try {
      const res = await verifyPostLocation(place.lat, place.lng);
      if (res.allowed && res.user_lat != null && res.user_lng != null && res.verified_at) {
        setTarget({
          kind: "linked",
          item: { id: place.id, title: place.title, location_name: place.location_name },
          itemKind: null,
          lat: res.user_lat,
          lng: res.user_lng,
          at: res.verified_at,
        });
        setStep("details");
      } else {
        setBlocked({ place, distance: res.distance });
        // Snap back to the top so the "post your location instead" warning + the full
        // "Nearby" list are visible together (otherwise the list stays mid-scroll).
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    } finally {
      setVerifying(false);
    }
  }

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
      setTarget({ kind: "mylocation", lat: loc.latitude, lng: loc.longitude, at: new Date().toISOString() });
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
        itemKind: target.kind === "linked" ? target.itemKind ?? null : null,
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

  function cancelPost() {
    Alert.alert("Discard post?", "Your photo and caption won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          clearPostDraft();
          router.replace("/(tabs)/feed" as any);
        },
      },
    ]);
  }

  const headerTop = insets.top + 14;
  const headerBack = (
    <Pressable
      onPress={() => (step === "details" && !preLinked ? setStep("pick") : router.back())}
      accessibilityLabel="Back"
      accessibilityRole="button"
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{ width: 40, height: 40, justifyContent: "center" }}
    >
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </Pressable>
  );

  function PlaceRow({ r }: { r: PlaceResult }) {
    return (
      <Pressable
        onPress={() => selectPlace(r)}
        disabled={verifying}
        accessibilityLabel={`Tag ${r.title}`}
        accessibilityRole="button"
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: verifying ? 0.5 : 1 }}
      >
        <Ionicons name="location-outline" size={20} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }} numberOfLines={1}>{r.title}</Text>
          {!!r.location_name && r.location_name !== r.title && (
            <Text style={{ fontSize: 12, color: colors.textSecondary }} numberOfLines={1}>{r.location_name}</Text>
          )}
        </View>
        <Text style={{ fontSize: 12, color: colors.textTertiary }}>{fmtDistance(r.distance_m)}</Text>
      </Pressable>
    );
  }

  // ---------- DETAILS ----------
  if (step === "details") {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingTop: headerTop }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {headerBack}
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text, marginLeft: 4 }}>Add details</Text>
          </View>
          <Pressable onPress={cancelPost} accessibilityLabel="Cancel post" accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ width: 44, height: 40, alignItems: "flex-end", justifyContent: "center", paddingRight: 8 }}>
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center" }} keyboardShouldPersistTaps="handled">
          {/* Big preview — mirrors the home-feed post (3:4). Dual shows the BeReal overlay. */}
          {draft && draft.mode === "dual" && draft.photos.length === 2 ? (
            <View style={{ width: "82%", aspectRatio: 3 / 4, borderRadius: 16, overflow: "hidden", backgroundColor: colors.surfaceVariant }}>
              <DualCameraPost backUri={draft.photos[0]} frontUri={draft.photos[1]} style={{ flex: 1 }} />
            </View>
          ) : previewUri ? (
            <Image
              source={{ uri: previewUri }}
              style={{ width: "82%", aspectRatio: 3 / 4, borderRadius: 16, backgroundColor: colors.surfaceVariant }}
              resizeMode="cover"
            />
          ) : null}

          {/* Where — linked place or My Location, on-theme. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: Colors.primary + "33", alignSelf: "stretch" }}>
            <Ionicons name={target?.kind === "linked" ? "location" : "navigate"} size={20} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }} numberOfLines={1}>
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

          <View style={{ gap: 8, alignSelf: "stretch" }}>
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
            style={{ padding: 16, borderRadius: 14, backgroundColor: posting ? colors.textSecondary : Colors.primary, alignItems: "center", marginTop: 4, alignSelf: "stretch" }}
          >
            {posting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Post</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ---------- PICK ----------
  const showNearby = query.trim().length < MIN_QUERY;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: headerTop }}>
        {headerBack}
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text, marginLeft: 4 }}>Where are you?</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inputBg }}>
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

        {locLoading && <Text style={{ fontSize: 13, color: colors.textSecondary }}>Getting your location…</Text>}
        {!locLoading && locError && (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.surface, gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>We couldn&rsquo;t get your location</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>Every post needs your location. Enable location for Euda in Settings, then reopen this screen.</Text>
          </View>
        )}
        {blocked && (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: Colors.primary + "14", borderWidth: 1, borderColor: Colors.primary, gap: 8 }}>
            <Text style={{ fontSize: 14, color: colors.text }}>
              You&rsquo;re not close enough to tag{" "}
              <Text style={{ fontWeight: "700" }}>{blocked.place.title}</Text>
              {blocked.distance != null ? ` (${fmtDistance(blocked.distance)} away)` : ""} — post your location instead.
            </Text>
          </View>
        )}
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        {/* Typed search results */}
        {!showNearby && results.map((r) => <PlaceRow key={r.id} r={r} />)}

        {/* Empty typed-search state (§5b) — never a dead end */}
        {!showNearby && searched && !searching && results.length === 0 && (
          <View style={{ paddingVertical: 20, alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>Can&rsquo;t find it?</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center" }}>No places match near you. You can still post as My Location.</Text>
          </View>
        )}

        {/* Nearby (no query) — tap a spot without typing */}
        {showNearby && nearby.length > 0 && (
          <>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textSecondary, letterSpacing: 0.5, textTransform: "uppercase", paddingBottom: 4 }}>Nearby</Text>
            {nearby.map((r) => <PlaceRow key={r.id} r={r} />)}
          </>
        )}
        {showNearby && !locLoading && !locError && nearby.length === 0 && (
          <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 12 }}>
            No places near you — search above, or just post your location.
          </Text>
        )}
      </ScrollView>

      {/* My Location — persistent, prominent. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
        {verifying ? (
          <View style={{ padding: 16, alignItems: "center" }}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <Pressable
            onPress={postMyLocation}
            disabled={verifying}
            accessibilityLabel="Post as My Location"
            accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 14, backgroundColor: Colors.primary }}
          >
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Post My Location</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
