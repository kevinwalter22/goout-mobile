/**
 * ViewModeToggle — Icon-only segmented control: Map | Cards | List
 */

import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";
import { Colors } from "../config/theme";

export type ViewMode = "map" | "cards" | "list";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const MODES: { key: ViewMode; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { key: "map", icon: "map-outline", label: "Map" },
  { key: "cards", icon: "grid-outline", label: "Cards" },
  { key: "list", icon: "list-outline", label: "List" },
];

function ViewModeToggleInner({ value, onChange }: ViewModeToggleProps) {
  const { colors } = useTheme();

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {MODES.map((mode) => {
        const isActive = value === mode.key;
        return (
          <Pressable
            key={mode.key}
            onPress={() => onChange(mode.key)}
            accessibilityLabel={mode.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={{
              padding: 6,
              borderRadius: 8,
              backgroundColor: isActive ? Colors.primary + "18" : "transparent",
            }}
          >
            <Ionicons
              name={mode.icon}
              size={20}
              color={isActive ? Colors.primary : colors.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export const ViewModeToggle = React.memo(ViewModeToggleInner);
