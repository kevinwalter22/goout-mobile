/**
 * Filter Sheet Component
 *
 * Bottom sheet with advanced filter options:
 * - Category
 * - Price bucket
 * - Time window
 * - Distance radius
 * - Sort option
 */

import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "../config/theme";
import { useTheme } from "../contexts/ThemeContext";
import {
  CATEGORIES,
  PRICE_OPTIONS,
  TIME_OPTIONS,
  DISTANCE_OPTIONS,
  SORT_OPTIONS,
  CategoryId,
  PriceBucket,
  TimeWindow,
  DistanceRadius,
  SortOption,
  ExploreFilterState,
} from "../config/exploreFilters";
import { triggerHaptic } from "../utils/haptics";

interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filters: ExploreFilterState;
  onCategoryChange: (category: CategoryId) => void;
  onPriceBucketChange: (price: PriceBucket) => void;
  onTimeWindowChange: (time: TimeWindow) => void;
  onDistanceChange: (distance: DistanceRadius) => void;
  onSortChange: (sort: SortOption) => void;
  onReset: () => void;
}

export function FilterSheet({
  visible,
  onClose,
  filters,
  onCategoryChange,
  onPriceBucketChange,
  onTimeWindowChange,
  onDistanceChange,
  onSortChange,
  onReset,
}: FilterSheetProps) {
  const { colors } = useTheme();

  // Activities don't have start times, so time-based options don't apply
  const isActivitiesOnly = filters.kindFilter === "activity";

  // Filter sort options: hide "soonest" for activities (they don't have dates)
  const availableSortOptions = isActivitiesOnly
    ? SORT_OPTIONS.filter((opt) => opt.id !== "soonest")
    : SORT_OPTIONS;

  const handleOptionSelect = <T,>(
    value: T,
    onChange: (val: T) => void
  ) => {
    triggerHaptic("light");
    onChange(value);
  };

  const handleReset = () => {
    triggerHaptic("medium");
    onReset();
  };

  const handleClose = () => {
    triggerHaptic("light");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Filters</Text>
          <View style={styles.headerButtons}>
            <Pressable onPress={handleReset} style={styles.resetButton}>
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
            <Pressable onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Sort By */}
          <FilterSection title="Sort By">
            <View style={styles.optionRow}>
              {availableSortOptions.map((option) => (
                <OptionChip
                  key={option.id}
                  label={option.label}
                  isSelected={filters.sort === option.id}
                  onPress={() => handleOptionSelect(option.id, onSortChange)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Time - hidden for activities since they don't have specific dates */}
          {!isActivitiesOnly && (
            <FilterSection title="When">
              <View style={styles.optionRow}>
                {TIME_OPTIONS.map((option) => (
                  <OptionChip
                    key={option.id}
                    label={option.label}
                    isSelected={filters.timeWindow === option.id}
                    onPress={() => handleOptionSelect(option.id, onTimeWindowChange)}
                  />
                ))}
              </View>
            </FilterSection>
          )}

          {/* Category */}
          <FilterSection title="Category">
            <View style={styles.optionRow}>
              {CATEGORIES.map((option) => (
                <OptionChip
                  key={option.id}
                  label={option.label}
                  isSelected={filters.category === option.id}
                  onPress={() => handleOptionSelect(option.id, onCategoryChange)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Price */}
          <FilterSection title="Price">
            <View style={styles.optionRow}>
              {PRICE_OPTIONS.map((option) => (
                <OptionChip
                  key={option.id}
                  label={option.label}
                  isSelected={filters.priceBucket === option.id}
                  onPress={() => handleOptionSelect(option.id, onPriceBucketChange)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Distance */}
          <FilterSection title="Distance">
            <View style={styles.optionRow}>
              {DISTANCE_OPTIONS.map((option) => (
                <OptionChip
                  key={String(option.id)}
                  label={option.label}
                  isSelected={filters.distance === option.id}
                  onPress={() => handleOptionSelect(option.id, onDistanceChange)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Apply button */}
        <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Pressable onPress={handleClose} style={styles.applyButton}>
            <Text style={styles.applyButtonText}>Show Results</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
}

function FilterSection({ title, children }: FilterSectionProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

interface OptionChipProps {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}

function OptionChip({ label, isSelected, onPress }: OptionChipProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.optionChip,
        { backgroundColor: colors.surfaceVariant, borderColor: colors.surfaceVariant },
        isSelected && styles.optionChipSelected,
      ]}
    >
      <Text
        style={[
          styles.optionChipText,
          { color: colors.text },
          isSelected && styles.optionChipTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.gray[900],
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  resetButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resetText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.gray[500],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.gray[100],
    borderWidth: 1,
    borderColor: Colors.gray[100],
  },
  optionChipSelected: {
    backgroundColor: Colors.primary + "15",
    borderColor: Colors.primary,
  },
  optionChipText: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.gray[700],
  },
  optionChipTextSelected: {
    color: Colors.primary,
    fontWeight: "600",
  },
  footer: {
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: "#fff",
  },
  applyButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
