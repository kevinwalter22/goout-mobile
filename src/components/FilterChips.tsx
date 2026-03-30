/**
 * Filter Chips Component
 *
 * Horizontal scrollable row of quick filter chips.
 * Config-driven - add/remove chips in exploreFilters.ts
 */

import { ScrollView, Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../config/theme";
import {
  QUICK_FILTERS,
  QuickFilterId,
  hasActiveFilters,
  ExploreFilterState,
} from "../config/exploreFilters";
import { triggerHaptic } from "../utils/haptics";

interface FilterChipsProps {
  activeQuickFilter: QuickFilterId | null;
  onQuickFilterPress: (id: QuickFilterId) => void;
  onFilterButtonPress: () => void;
  hasAdvancedFilters: boolean;
  filters: ExploreFilterState;
}

export function FilterChips({
  activeQuickFilter,
  onQuickFilterPress,
  onFilterButtonPress,
  hasAdvancedFilters,
  filters,
}: FilterChipsProps) {
  const handleChipPress = (id: QuickFilterId) => {
    triggerHaptic("light");
    onQuickFilterPress(id);
  };

  const handleFilterPress = () => {
    triggerHaptic("light");
    onFilterButtonPress();
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Filter button (opens advanced filters) */}
        <Pressable
          onPress={handleFilterPress}
          accessibilityLabel={hasAdvancedFilters ? `Filters, ${countActiveAdvancedFilters(filters)} active` : "Filters"}
          accessibilityRole="button"
          accessibilityState={{ selected: hasAdvancedFilters }}
          style={[
            styles.filterButton,
            hasAdvancedFilters && styles.filterButtonActive,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={18}
            color={hasAdvancedFilters ? "#fff" : Colors.gray[600]}
          />
          {hasAdvancedFilters && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>
                {countActiveAdvancedFilters(filters)}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Quick filter chips */}
        {QUICK_FILTERS.map((filter) => {
          const isActive = activeQuickFilter === filter.id;

          return (
            <Pressable
              key={filter.id}
              onPress={() => handleChipPress(filter.id)}
              accessibilityLabel={filter.label}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Count how many advanced filters are active
 */
function countActiveAdvancedFilters(filters: ExploreFilterState): number {
  let count = 0;
  if (filters.categories.length > 0) count++;
  if (filters.priceBucket !== "all") count++;
  if (filters.timeWindow !== "all") count++;
  if (filters.distance !== 50) count++;
  return count;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  filterButton: {
    width: 40,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.gray[100],
    justifyContent: "center",
    alignItems: "center",
    marginRight: 4,
  },
  filterButtonActive: {
    backgroundColor: Colors.primary,
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.gray[800],
    justifyContent: "center",
    alignItems: "center",
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: Colors.gray[100],
  },
  chipActive: {
    backgroundColor: Colors.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.gray[700],
  },
  chipTextActive: {
    color: "#fff",
  },
});
