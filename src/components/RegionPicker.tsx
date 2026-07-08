/**
 * RegionPicker — the metro switcher chip + "Pick your city" modal.
 *
 * Renders a compact chip showing the active region; tapping opens a modal list
 * of regions plus "Use my location". When `forceOpen` is set (the resolver
 * couldn't determine a region and there's no manual pick), the modal opens and
 * cannot be dismissed without choosing — the feed is never shown unscoped.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import type { Region } from "../hooks/useRegion";

interface Props {
  regions: Region[];
  activeRegion: Region | null;
  onSelect: (regionId: string | null) => void;
  /** Open (and lock) the modal because no region is resolvable. */
  forceOpen?: boolean;
  /** Whether a live/last-known location exists → offer "Use my location". */
  hasLocation?: boolean;
}

export function RegionPicker({ regions, activeRegion, onSelect, forceOpen, hasLocation }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const label = activeRegion?.name ?? "Pick your city";

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          alignSelf: "flex-start",
        }}
        hitSlop={8}
      >
        <Ionicons name="location-outline" size={14} color={Colors.primary} />
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{label}</Text>
        <Ionicons name="chevron-down" size={13} color={colors.textSecondary} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!forceOpen) setOpen(false);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 }}
          onPress={() => {
            if (!forceOpen) setOpen(false);
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{ backgroundColor: colors.background, borderRadius: 16, overflow: "hidden" }}
          >
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text }}>
                {forceOpen ? "Pick your city" : "Choose a city"}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                Events and activities are shown for one city at a time.
              </Text>
            </View>

            {hasLocation && (
              <Pressable
                onPress={() => {
                  onSelect(null); // clear manual pick → follow location
                  setOpen(false);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <Ionicons name="navigate" size={18} color={Colors.primary} />
                <Text style={{ fontSize: 15, fontWeight: "600", color: Colors.primary }}>Use my location</Text>
              </Pressable>
            )}

            {regions.map((r) => {
              const selected = activeRegion?.id === r.id;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    onSelect(r.id);
                    setOpen(false);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ fontSize: 15, fontWeight: selected ? "700" : "500", color: colors.text }}>{r.name}</Text>
                  {selected && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
