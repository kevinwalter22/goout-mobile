import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type ThemeColors,
  lightTheme,
  darkTheme,
} from "../config/theme";

const STORAGE_KEY = "@euda_theme_mode";

export type ThemeMode = "light" | "dark" | "system";

type ThemeContextType = {
  colors: ThemeColors;
  mode: ThemeMode;
  effectiveMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  colors: lightTheme,
  mode: "system",
  effectiveMode: "light",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [loaded, setLoaded] = useState(false);

  // Load persisted preference on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setModeState(stored);
      }
      setLoaded(true);
    });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const effectiveMode: "light" | "dark" =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;

  const colors = effectiveMode === "dark" ? darkTheme : lightTheme;

  // Don't flash wrong theme while loading preference
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={{ colors, mode, effectiveMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
