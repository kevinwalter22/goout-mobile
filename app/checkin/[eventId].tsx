import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CAMERA_MODES } from "../../src/config/constants";

export default function CheckInModeSelector() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  function selectMode(mode: string) {
    router.push({
      pathname: "/checkin/camera",
      params: { eventId, mode },
    } as any);
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 20 }}>
      <View style={{ gap: 8, marginBottom: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: "700" }}>Choose Camera Mode</Text>
        <Text style={{ fontSize: 16, opacity: 0.7 }}>
          How do you want to capture this moment?
        </Text>
      </View>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.BACK)}
        style={{
          padding: 20,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: "#000",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 4 }}>
          Back Camera
        </Text>
        <Text style={{ opacity: 0.7 }}>Capture what you&apos;re seeing</Text>
      </Pressable>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.FRONT)}
        style={{
          padding: 20,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: "#000",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 4 }}>
          Front Camera
        </Text>
        <Text style={{ opacity: 0.7 }}>Take a selfie</Text>
      </Pressable>

      <Pressable
        onPress={() => selectMode(CAMERA_MODES.DUAL)}
        style={{
          padding: 20,
          borderRadius: 12,
          backgroundColor: "#000",
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 4,
            color: "#fff",
          }}
        >
          Dual Camera
        </Text>
        <Text style={{ opacity: 0.7, color: "#fff" }}>
          Capture both views (back then front)
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.back()}
        style={{
          marginTop: 16,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 16, opacity: 0.7 }}>Cancel</Text>
      </Pressable>
    </View>
  );
}
