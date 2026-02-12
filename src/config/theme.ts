/**
 * Euda Brand Theme
 * Color palette and design tokens for consistent branding
 */

export const Colors = {
  // Brand Colors
  primary: "#7B3FF2", // Euda Purple
  primaryDark: "#6226D9",
  primaryLight: "#9D6BF5",

  // Neutral Colors
  black: "#000000",
  white: "#FFFFFF",
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },

  // Semantic Colors
  success: "#10B981",
  error: "#EF4444",
  warning: "#F59E0B",
  info: "#3B82F6",

  // UI Colors (for backwards compatibility, gradually migrate to purple)
  background: "#FFFFFF",
  border: "#E5E7EB",
  text: {
    primary: "#111827",
    secondary: "#6B7280",
    tertiary: "#9CA3AF",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
};

export const FontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 28,
};

export const FontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

// ---------------------------------------------------------------------------
// Semantic theme colors — change between light and dark modes
// ---------------------------------------------------------------------------

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceVariant: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderLight: string;
  separator: string;
  inputBg: string;
  cardBg: string;
  overlay: string;
  tabBar: string;
};

export const lightTheme: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceVariant: "#F5F5F5",
  text: "#111827",
  textSecondary: "#6B7280",
  textTertiary: "#9CA3AF",
  border: "#E5E7EB",
  borderLight: "#F0F0F0",
  separator: "#E0E0E0",
  inputBg: "#F5F5F5",
  cardBg: "#FFFFFF",
  overlay: "rgba(0,0,0,0.5)",
  tabBar: "#FFFFFF",
};

export const darkTheme: ThemeColors = {
  background: "#121212",
  surface: "#1E1E1E",
  surfaceVariant: "#2C2C2E",
  text: "#F0F0F0",
  textSecondary: "#A0A0A0",
  textTertiary: "#666666",
  border: "#333333",
  borderLight: "#262626",
  separator: "#2C2C2E",
  inputBg: "#2C2C2E",
  cardBg: "#1E1E1E",
  overlay: "rgba(0,0,0,0.7)",
  tabBar: "#1A1A1A",
};
