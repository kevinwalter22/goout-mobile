import { useState, useCallback } from "react";
import { Alert, Platform } from "react-native";
import * as Contacts from "expo-contacts";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";
import { useFeatureFlags } from "./useFeatureFlags";
import { normalizePhone, hashPhone } from "../utils/phoneHash";
import { logAnalyticsEvent } from "../lib/analyticsLogger";
import { captureError } from "../lib/logger";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useContactSync() {
  const { user, profile, refreshProfile } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const contactsSyncEnabled = isEnabled("contacts_sync");

  const [syncing, setSyncing] = useState(false);

  const lastSyncedAt = profile?.contacts_synced_at
    ? new Date(profile.contacts_synced_at)
    : null;

  const needsSync =
    !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > SEVEN_DAYS_MS;

  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!user || !contactsSyncEnabled || Platform.OS === "web") return false;

    setSyncing(true);
    let matchCount = 0;

    try {
      // 1. Request permission
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "To find friends from your contacts, please allow access in your device Settings.",
        );
        return false;
      }

      // 2. Read contacts (phone numbers only)
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      if (!data || data.length === 0) return false;

      // 3. Extract, normalize, and dedupe phone numbers — all on-device
      const rawPhones: string[] = [];
      for (const contact of data) {
        if (contact.phoneNumbers) {
          for (const pn of contact.phoneNumbers) {
            if (pn.number) {
              const normalized = normalizePhone(pn.number);
              if (normalized) rawPhones.push(normalized);
            }
          }
        }
      }

      const uniquePhones = [...new Set(rawPhones)];
      if (uniquePhones.length === 0) return false;

      // 4. Hash on-device — raw numbers never leave the device
      const hashedPhones = await Promise.all(uniquePhones.map(hashPhone));

      // 5. Send ONLY hashes to server
      const { error } = await (supabase.rpc as any)(
        "sync_contact_suggestions",
        { p_user_id: user.id, p_hashed_phones: hashedPhones },
      );

      if (error) {
        captureError(error, { action: "syncContactSuggestions" });
        return false;
      }

      matchCount = hashedPhones.length;

      // 6. Refresh profile so contacts_synced_at is up-to-date
      await refreshProfile();
      return true;
    } catch (err) {
      captureError(err, { action: "contactsSync" });
      return false;
    } finally {
      logAnalyticsEvent(user!.id, "contacts_sync_completed", {
        matchCount,
      });
      setSyncing(false);
    }
  }, [user, contactsSyncEnabled, refreshProfile]);

  const clearSuggestions = useCallback(async () => {
    if (!user) return;

    try {
      const { error } = await (supabase.rpc as any)(
        "clear_contact_suggestions",
        { p_user_id: user.id },
      );

      if (error) {
        captureError(error, { action: "clearContactSuggestions" });
        Alert.alert("Error", "Failed to clear contact suggestions.");
        return;
      }

      await refreshProfile();
    } catch (err) {
      captureError(err, { action: "clearContactSuggestions" });
      Alert.alert("Error", "Something went wrong.");
    }
  }, [user, refreshProfile]);

  return {
    syncing,
    lastSyncedAt,
    needsSync,
    contactsSyncEnabled,
    syncNow,
    clearSuggestions,
  };
}
