import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { Colors } from "../config/theme";
import { emojiForItem } from "../utils/mapEmoji";
import type { ExploreItem } from "../types/database";

// Map markers rendered as pre-generated IMAGES instead of live React views.
// A live-view marker (`<Marker>` with a child View + tracksViewChanges) is
// fundamentally unreliable on react-native-maps' New Architecture — it loses its
// rasterization race (MapKit falls back to the default red pin), blanks on tap,
// and churns on zoom/pan (see docs/design/map_events_overhaul.md). Instead we
// render each distinct emoji-teardrop ONCE off-screen, snapshot it to an image
// (view-shot), cache the data-URI, and hand static images to MapKit — which it
// renders rock-solid and GPU-composited, scaling to hundreds of pins.

export const PIN_HEAD = 38;

/** The teardrop badge we snapshot — must match the on-map look exactly. */
function MarkerBadge({ emoji, selected }: { emoji: string; selected: boolean }) {
  const tint = selected ? Colors.primaryDark : Colors.primary;
  const head = selected ? PIN_HEAD + 6 : PIN_HEAD;
  return (
    // Small horizontal padding leaves room for the shadow so it isn't clipped;
    // no bottom padding so the tail tip sits at the image's bottom edge (anchor
    // y=1 then places the tip exactly on the coordinate).
    <View style={{ alignItems: "center", paddingHorizontal: 6, paddingTop: 6 }}>
      <View
        style={{
          width: head,
          height: head,
          borderRadius: head / 2,
          backgroundColor: "#fff",
          borderWidth: selected ? 3 : 2,
          borderColor: tint,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.28,
          shadowRadius: 3,
          elevation: 5,
        }}
      >
        <Text style={{ fontSize: selected ? 22 : 19 }}>{emoji}</Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 7,
          borderRightWidth: 7,
          borderTopWidth: 10,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: tint,
          marginTop: -2,
        }}
      />
    </View>
  );
}

type Spec = { key: string; emoji: string; selected: boolean };

export function markerKey(item: Pick<ExploreItem, "category" | "sub_category" | "kind">, selected: boolean): string {
  return `${emojiForItem(item)}|${selected ? "s" : "n"}`;
}

/**
 * Returns the cached marker-image URIs (keyed by `${emoji}|s|n`) plus a hidden
 * off-screen `renderer` element the caller must mount so the badges can be
 * snapshotted. Each distinct (emoji, selected) badge is captured once and reused
 * for every pin that needs it, so this stays cheap even with hundreds of pins.
 */
export function useMarkerImages(items: ExploreItem[]) {
  const [uris, setUris] = useState<Map<string, string>>(new Map());
  const refs = useRef<Map<string, View | null>>(new Map());

  const specs = useMemo<Spec[]>(() => {
    const m = new Map<string, Spec>();
    for (const it of items) {
      const emoji = emojiForItem(it);
      for (const selected of [false, true]) {
        const key = `${emoji}|${selected ? "s" : "n"}`;
        if (!m.has(key)) m.set(key, { key, emoji, selected });
      }
    }
    return [...m.values()];
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Let the hidden views lay out before snapshotting.
      await new Promise((r) => setTimeout(r, 60));
      let changed = false;
      const next = new Map(uris);
      for (const spec of specs) {
        if (next.has(spec.key)) continue;
        const ref = refs.current.get(spec.key);
        if (!ref) continue;
        try {
          const uri = await captureRef(ref, { format: "png", quality: 1, result: "data-uri" });
          if (uri) {
            next.set(spec.key, uri);
            changed = true;
          }
        } catch {
          // Snapshot failed for this badge — skip; the pin just waits.
        }
      }
      if (!cancelled && changed) setUris(next);
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs]);

  const renderer = (
    <View style={{ position: "absolute", left: -10000, top: -10000 }} pointerEvents="none">
      {specs.map((spec) => (
        <View
          key={spec.key}
          collapsable={false}
          ref={(r) => {
            refs.current.set(spec.key, r);
          }}
        >
          <MarkerBadge emoji={spec.emoji} selected={spec.selected} />
        </View>
      ))}
    </View>
  );

  return { uris, renderer };
}
