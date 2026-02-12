import { useEffect } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";

export type ToastType = "success" | "error" | "info";

type ToastProps = {
  visible: boolean;
  message: string;
  type: ToastType;
  onHide: () => void;
  duration?: number;
};

export function Toast({ visible, message, type, onHide, duration = 3000 }: ToastProps) {
  const opacity = new Animated.Value(0);

  useEffect(() => {
    if (visible) {
      // Fade in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Auto-hide after duration
      const timer = setTimeout(() => {
        // Fade out
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          onHide();
        });
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, duration, onHide, opacity]);

  if (!visible) return null;

  const backgroundColor =
    type === "success"
      ? "#4CAF50"
      : type === "error"
      ? "#F44336"
      : "#2196F3";

  const icon =
    type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";

  return (
    <Animated.View
      style={[
        styles.container,
        { backgroundColor, opacity },
      ]}
    >
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.message}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 60,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 9999,
  },
  icon: {
    fontSize: 20,
    color: "#fff",
    fontWeight: "700",
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
});
