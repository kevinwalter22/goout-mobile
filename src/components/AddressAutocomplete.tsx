import { useState, useCallback, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/ThemeContext";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export interface AddressSuggestion {
  id: string;
  displayName: string;
  shortName: string; // Simplified address for display
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectAddress: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
}

/**
 * Simplify a Nominatim address to just the essential parts
 * "23, Pierrepont Avenue, Village of Potsdam, Town of Potsdam, Saint Lawrence County, New York, 13676, United States"
 * becomes: "23 Pierrepont Avenue, Potsdam, NY 13676"
 */
function simplifyAddress(fullAddress: string): string {
  const parts = fullAddress.split(", ");
  if (parts.length < 3) return fullAddress;

  // Extract key parts
  const streetParts: string[] = [];
  let city = "";
  let state = "";
  let zip = "";

  for (const part of parts) {
    // Skip "Village of", "Town of", "County" parts
    if (part.startsWith("Village of") || part.startsWith("Town of") || part.includes("County")) {
      // Extract city name from "Village of X" or "Town of X"
      if (!city && (part.startsWith("Village of") || part.startsWith("Town of"))) {
        city = part.replace(/^(Village|Town) of /, "");
      }
      continue;
    }

    // Skip "United States"
    if (part === "United States" || part === "USA") continue;

    // Check for state (2 or more words that are a US state or abbreviation)
    if (!state && /^[A-Z][a-z]+ ?[A-Z]?[a-z]*$/.test(part) && parts.indexOf(part) > parts.length - 4) {
      // Convert full state name to abbreviation
      state = getStateAbbreviation(part) || part;
      continue;
    }

    // Check for ZIP code
    if (!zip && /^\d{5}(-\d{4})?$/.test(part)) {
      zip = part;
      continue;
    }

    // First 1-2 parts are usually street address
    if (streetParts.length < 2 && parts.indexOf(part) < 2) {
      streetParts.push(part);
      continue;
    }

    // Use as city if we don't have one and it's not a number
    if (!city && !/^\d+$/.test(part) && parts.indexOf(part) > 1) {
      city = part;
    }
  }

  // Build simplified address
  const street = streetParts.join(" ");
  const result: string[] = [];

  if (street) result.push(street);
  if (city) result.push(city);
  if (state && zip) {
    result.push(`${state} ${zip}`);
  } else if (state) {
    result.push(state);
  } else if (zip) {
    result.push(zip);
  }

  return result.join(", ") || fullAddress;
}

function getStateAbbreviation(state: string): string | null {
  const states: Record<string, string> = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
    "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
    "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
  };
  return states[state] || null;
}

export function AddressAutocomplete({
  value,
  onChangeText,
  onSelectAddress,
  placeholder = "Street address or general location",
}: AddressAutocompleteProps) {
  const { colors } = useTheme();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchRef = useRef<string>("");

  // Fetch suggestions from Nominatim
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    // Don't search if same as last search
    if (query === lastSearchRef.current) {
      return;
    }
    lastSearchRef.current = query;

    setLoading(true);

    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "5",
        addressdetails: "0",
      });

      const response = await fetch(`${NOMINATIM_URL}?${params}`, {
        headers: {
          "User-Agent": "EudaApp/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const results: NominatimResult[] = await response.json();

      const mapped: AddressSuggestion[] = results.map((r) => ({
        id: r.place_id.toString(),
        displayName: r.display_name,
        shortName: simplifyAddress(r.display_name),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      }));

      setSuggestions(mapped);
      setShowSuggestions(mapped.length > 0);
    } catch (error) {
      console.log("[AddressAutocomplete] Search error:", error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  const handleTextChange = useCallback(
    (text: string) => {
      onChangeText(text);

      // Clear previous timer
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Set new timer
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(text);
      }, DEBOUNCE_MS);
    },
    [onChangeText, fetchSuggestions]
  );

  // Handle selection - use short name for display, but pass full details
  const handleSelect = useCallback(
    (suggestion: AddressSuggestion) => {
      onChangeText(suggestion.shortName); // Use simplified address
      onSelectAddress(suggestion);
      setSuggestions([]);
      setShowSuggestions(false);
      lastSearchRef.current = suggestion.shortName;
      Keyboard.dismiss();
    },
    [onChangeText, onSelectAddress]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <View style={{ position: "relative", zIndex: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 16,
        }}
      >
        <TextInput
          value={value}
          onChangeText={handleTextChange}
          onFocus={() => {
            if (suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          style={{
            flex: 1,
            fontSize: 16,
            color: colors.text,
            paddingVertical: 16,
          }}
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        )}
        {!loading && value.length > 0 && (
          <Pressable
            onPress={() => {
              onChangeText("");
              setSuggestions([]);
              setShowSuggestions(false);
              lastSearchRef.current = "";
            }}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {showSuggestions && suggestions.length > 0 && (
        <View
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            overflow: "hidden",
            maxHeight: 250,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 8,
            elevation: 5,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {suggestions.map((item, index) => (
              <Pressable
                key={item.id}
                onPress={() => handleSelect(item)}
                style={{
                  padding: 14,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: colors.separator,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={colors.textSecondary}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: "500",
                        color: colors.text,
                        lineHeight: 20,
                      }}
                    >
                      {item.shortName}
                    </Text>
                    {item.shortName !== item.displayName && (
                      <Text
                        style={{
                          fontSize: 12,
                          color: colors.textTertiary,
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        {item.displayName}
                      </Text>
                    )}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Tap outside to close suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <Pressable
          onPress={() => setShowSuggestions(false)}
          style={{
            position: "absolute",
            top: 60,
            bottom: -500,
            left: -100,
            right: -100,
            zIndex: -1,
          }}
        />
      )}
    </View>
  );
}
