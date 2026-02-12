# Explore Tab Filters - Debug Guide

This document describes the debug tools, verification steps, and acceptance criteria for the Explore tab filtering system.

## Overview

The Explore tab has two filter interfaces:
1. **Quick Filters (Chips)**: Preset filter combinations displayed as tappable chips
2. **Advanced Filters (Modal)**: Category, price, time window, and distance selectors

### Single Source of Truth

All filters share a single state object (`ExploreFilterState`). When a quick filter is active, its criteria **override** the advanced filter values. When an advanced filter is changed, any active quick filter is **cleared**.

```typescript
type ExploreFilterState = {
  quickFilter: QuickFilterId | null;  // Active chip
  category: CategoryId;                // "all" | "outdoor" | "nightlife" | ...
  priceBucket: PriceBucket;           // "all" | "free" | "$" | "$$" | "$$$"
  timeWindow: TimeWindow;             // "all" | "today" | "week" | "month"
  distance: DistanceRadius;           // 5 | 10 | 25 | 50
  sort: SortOption;                   // "relevance" | "distance" | "date"
  page: number;                       // Pagination
};
```

---

## Debug Panel

A development-only debug panel is available in the Explore tab.

### Enabling the Debug Panel

1. Open the Explore tab
2. Tap the **🔧** button in the header (only visible in `__DEV__` mode)
3. The debug panel will slide down from the top

### Debug Panel Contents

| Section | Description |
|---------|-------------|
| **Filter State** | Current values of all filter fields |
| **Effective Filters** | What's actually applied after quick filter resolution |
| **Query Stats** | Total count from database, loaded items count |
| **Postable Now** | Number of items currently postable |

### Enabling Debug Logs

In `src/config/exploreFilters.ts`:

```typescript
export const EXPLORE_DEBUG_MODE = true; // Set to true for console logs
```

This enables:
- Filter state logging on every query execution
- Pagination details (items loaded vs total)
- Quick filter resolution logging

---

## Acceptance Criteria Checklist

### Part A: Chip + Dropdown State Conflicts ✅

- [ ] Tapping a quick filter chip updates the results immediately
- [ ] Tapping an already-active chip deactivates it
- [ ] Changing any advanced filter clears the active quick filter chip
- [ ] Quick filter criteria override advanced filter values (verify in debug panel)
- [ ] Distance filter applies alongside both quick and advanced filters

### Part B: Accurate Result Count ✅

- [ ] Result count shows accurate total immediately after filter change
- [ ] Format: "Showing X of Y" when not all items loaded
- [ ] Format: "Y results" when all items loaded
- [ ] Count updates correctly after pagination load

### Part C: Data Normalization ✅

- [ ] Category filter matches both "Outdoor" and "outdoors" in data
- [ ] Price filter works with "$", "cheap", "free", etc.
- [ ] Tags are normalized to canonical values
- [ ] Town names handle "Burlington" vs "Burlington, VT"

### Part D: Postable Now Section ✅

- [ ] "Postable Now" section appears at top when items are nearby
- [ ] Items have highlighted border (primary color, 2px)
- [ ] "POST NOW" badge visible on postable items
- [ ] In-progress events show highest priority
- [ ] Starting soon events show medium priority
- [ ] Always-available activities show lower priority
- [ ] Maximum 10 items in Postable Now section

### Part E: Verification Tools ✅

- [ ] Debug panel shows filter state in dev mode
- [ ] Console logs filter changes when debug mode enabled
- [ ] Test suite passes all filter scenarios

---

## Testing Quick Filters

### "Happening Now" Filter
- Should show events with `starts_at` today
- Should show in-progress events with higher priority
- Verify: Tap chip → check debug panel shows `timeWindow: "today"`

### "Hidden Gems" Filter
- Should show only items with `is_hidden_gem: true`
- Verify: Tap chip → check debug panel shows `isHiddenGem: true`

### "Free Stuff" Filter
- Should show items with `price_bucket: "free"`
- Verify: Tap chip → check debug panel shows `priceBucket: "free"`

### "Weekend Vibes" Filter
- Should show nightlife category + weekend time
- Verify: Tap chip → check debug panel shows category and time criteria

---

## Testing Advanced Filters

### Category Filter
1. Open filter modal
2. Select "Outdoor"
3. Verify: Only outdoor activities/events shown
4. Verify: Any active quick filter is cleared

### Price Filter
1. Open filter modal
2. Select "Free"
3. Verify: Only free items shown
4. Verify: Works with both `price_bucket: "free"` and normalized values

### Time Window Filter
1. Open filter modal
2. Select "Today"
3. Verify: Only events with today's date shown
4. Verify: Activities without dates are excluded (or included based on schedule)

### Distance Filter
1. Open filter modal
2. Set distance to 5 miles
3. Verify: Only items within 5 miles shown
4. Note: Distance applies alongside other filters (doesn't clear them)

---

## Postable Now Logic

An item is "postable now" if:
1. **Distance**: Within 1 mile of user's location (default radius)
2. **Time**: One of:
   - Event is currently in progress
   - Event starts within 60 minutes (pre-buffer)
   - Event ended within 120 minutes (post-buffer)
   - Activity has no specific time (always available)

### Priority Calculation

| Reason | Base Priority | Notes |
|--------|---------------|-------|
| `in_progress` | 10 | Highest priority |
| `starting_soon` | 20-26 | + minutes until start / 10 |
| `always_available` | 30 | Activities |
| `nearby` | 40 | Within radius but no time info |

Distance adjustment: `-2 * (5 - distance)` for items closer than 5 miles

---

## Running Tests

```bash
# Run all filter tests
npm test -- --testPathPattern=exploreFilters

# Run with verbose output
npm test -- --testPathPattern=exploreFilters --verbose

# Run specific test suite
npm test -- --testPathPattern=exploreFilters -t "Filter State Management"
```

---

## Common Issues & Solutions

### Issue: Result count shows 0 but items are visible
**Cause**: Query error or stale state
**Solution**: Check console for errors, verify Supabase query executes

### Issue: Quick filter doesn't update results
**Cause**: Filter state not triggering query
**Solution**: Verify `updateFiltersAndQuery` is called in filter action

### Issue: Items appear in wrong section (Postable Now vs regular)
**Cause**: Location not available or incorrect coordinates
**Solution**: Check `userLocation` is set, verify item has lat/lng

### Issue: Normalized values don't match
**Cause**: Synonym not in mapping
**Solution**: Add synonym to `CATEGORY_SYNONYMS` or `PRICE_SYNONYMS` in normalizeExploreItem.ts

---

## Debug Logging Examples

### Filter Query Execution
```
[ExploreFilters] executeQuery {
  state: { quickFilter: "free_stuff", category: "all", ... },
  queryVersion: 3,
  append: false,
  userLocation: "provided"
}
```

### Effective Filters Resolution
```
[ExploreFilters] getEffectiveFilters {
  input: { quickFilter: "free_stuff", priceBucket: "all" },
  output: { priceBucket: "free" }  // Quick filter criteria applied
}
```

### Pagination
```
[ExploreFilters] Pagination append {
  prevCount: 20,
  newCount: 18,
  totalLoaded: 38,
  totalCount: 156,
  hasMore: true
}
```

---

## Architecture Notes

### File Locations

| File | Purpose |
|------|---------|
| `src/config/exploreFilters.ts` | Filter definitions, debug config |
| `src/hooks/useExploreFilters.ts` | Filter state management hook |
| `src/lib/exploreQuery.ts` | Supabase query builder |
| `src/lib/normalizeExploreItem.ts` | Data normalization utilities |
| `src/lib/postableNow.ts` | Postable Now logic |
| `app/(tabs)/explore.tsx` | UI implementation |
| `__tests__/exploreFilters.test.ts` | Test suite |

### Data Flow

```
User Action (tap chip/change filter)
    ↓
setQuickFilter / setCategory / etc.
    ↓
updateFiltersAndQuery(newFilters)
    ↓
setFilters(newFilters)  →  UI re-renders with new state
    ↓
executeQuery(newFilters)
    ↓
queryExploreItems(supabase, filters)  →  Supabase RPC
    ↓
setItems(results)  →  UI shows filtered results
setTotalCount(count)  →  Accurate count displayed
```

---

## Contact

For questions about the filter system, check the implementation in the files listed above or run the test suite to verify behavior.
