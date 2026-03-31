import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { cancelLocationPicker } from "../src/utils/locationPickerStore";

/**
 * Web stub for the location picker.
 * On web, the map-based pin picker is not available (react-native-maps is native-only).
 * Use the address autocomplete field in the create/edit event form instead.
 * This stub cancels the pending callback and returns immediately so the form is not left waiting.
 */
export default function LocationPickerWeb() {
  useEffect(() => {
    cancelLocationPicker();
    router.back();
  }, []);

  return <View />;
}
