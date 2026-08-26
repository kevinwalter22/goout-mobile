import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useNavigation } from "expo-router";

/**
 * Intercepts navigation-away attempts (native edge-swipe, mid-screen
 * SwipeableBackGesture, header back button) via react-navigation's
 * `beforeRemove` event and confirms discard when the form is dirty.
 * Fires for every back trigger since they all route through
 * navigation.goBack() under the hood, so screens don't need to guard
 * each gesture path separately.
 *
 * Returns `allowNextBack`, which callers should invoke immediately before
 * navigating away after a successful save — that back is not a discard, so
 * it should skip the prompt even though the form still reads as dirty.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const navigation = useNavigation();
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const bypassRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }

      if (!isDirtyRef.current) return;

      e.preventDefault();

      Alert.alert(
        "Discard changes?",
        "You have unsaved changes. Are you sure you want to discard them?",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(e.data.action),
          },
        ],
      );
    });

    return unsubscribe;
  }, [navigation]);

  function allowNextBack() {
    bypassRef.current = true;
  }

  return allowNextBack;
}
