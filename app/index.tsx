import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "../src/hooks/useAuth";

export default function Home() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace("/(tabs)/feed" as any);
      } else {
        router.replace("/(auth)/signin" as any);
      }
    }
  }, [user, loading]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
