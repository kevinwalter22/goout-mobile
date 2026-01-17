import { Text, View } from "react-native";

export default function Events() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Today / Tonight</Text>
      <Text style={{ marginTop: 8 }}>
        Next: wire Supabase + location + curated events.
      </Text>
    </View>
  );
}
