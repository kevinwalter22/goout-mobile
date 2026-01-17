import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center", gap: 16 }}>
      <Text style={{ fontSize: 28, fontWeight: "700" }}>GoOut</Text>
      <Text style={{ fontSize: 16 }}>
        Presence &gt; content. Let’s get you off the couch.
      </Text>

      <Link href="/events" asChild>
        <Pressable
          style={{
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "600" }}>See Today</Text>
        </Pressable>
      </Link>
    </View>
  );
}
