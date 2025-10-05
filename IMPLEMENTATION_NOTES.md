# GMAT Focus Practice App - Cross-Device Consistency Implementation

## Summary of Changes

All requested fixes have been implemented to ensure the app works identically on desktop and mobile (iOS Safari), respects section order for full tests, and never repeats questions within a section.

## 1. Robust Bank Loader (Mobile/iOS Safe) ✅

### Changes Made:
- **New Function**: `loadBanks({ force })`
  - Uses fetch with relative paths (`./data/bank_*.json`)
  - Implements cache-buster when `force=true`: `?v=${Date.now()}`
  - Uses `cache: 'no-store'` and `Cache-Control: no-cache` headers
  - Validates all responses with explicit HTTP status checks
  - Validates JSON shape: checks for `items` array, non-empty
  - Throws descriptive errors with exact URL and status codes
  - Stores banks in `window.BANKS` (not internal state)

### Error Handling:
- Shows exact error messages in toast: "Bank HTTP 404: ./data/bank_quant.json (Quant)"
- Never falls back to sample data silently
- All errors are user-visible

### ES2019 Compliance:
- No `toSorted` (used `.slice().sort()`)
- No `structuredClone` (used manual deep copy patterns)
- No `Promise.any` (used `Promise.all` with validation)
- Used `var` in loops for older JS engines
- Used `.concat()` instead of spread operator in some places
- String concatenation instead of template literals where beneficial

## 2. Section Order for Full Test ✅

### Changes Made:
- **New Function**: `startFullTest()`
  - Reads section order from dropdown (`#orderSelect`)
  - Maps order codes to section arrays:
    - `QVD` → `['Quant', 'Verbal', 'Data Insights']`
    - `QDV` → `['Quant', 'Data Insights', 'Verbal']`
    - etc. (all 6 permutations)
  - Creates `window.currentRun` with queue and index
  
- **New Function**: `startNextSectionInQueue()`
  - Automatically advances through sections
  - Increments queue index after each section submission
  - Shows completion toast when all sections done

- **Button Wiring**:
  - "Start Practice" button → `startFullTest()`
  - Individual section buttons → `startSingle(section)`
  - Both paths work correctly

### Behavior:
- Full test respects chosen section order
- Sections auto-advance after submission
- Brief results shown (3s) before next section
- Individual section buttons still work for single-section practice

## 3. Never Repeat Questions (Uniqueness Guarantees) ✅

### Changes Made:
- **New Functions**:
  - `shuffleInPlace(a)` - Fisher-Yates shuffle
  - `sampleWithoutReplacement(pool, count)` - guaranteed unique sampling
  - `assertUnique(items)` - throws if duplicates detected
  - `assembleSection(section, count)` - builds section with uniqueness

### Assembly Process:
1. Filter pool by exposure control (if enabled)
2. Build weighted pools (30% E, 50% M, 20% H)
3. Sample from each difficulty bucket without replacement
4. Track `selectedIds` Set during assembly
5. Backfill from remaining pool if needed
6. Assert uniqueness before returning
7. Write selected IDs to `APP_STATE.sessionUsedIds`

### Exposure Control:
- When enabled, filters out `APP_STATE.usedItemIds`
- Shows warning if bank exhausted: "⚠️ Bank exhausted for Quant. Using all remaining unique items."
- Never duplicates within a section
- Respects cross-session exposure tracking

## 4. Cross-Browser Event Wiring (Mobile-Safe) ✅

### Changes Made:
- **All buttons**: Added `type="button"` (24 buttons updated)
  - Setup screen buttons
  - Question navigation buttons
  - Modal close buttons
  - Calculator buttons (20 buttons)
  
- **Event Binding**: Changed to `DOMContentLoaded`
  - All event listeners attached on `DOMContentLoaded`
  - Used `.onclick` assignment for critical buttons
  - Used `.addEventListener` for supporting functionality

### iOS Safari Compatibility:
- No form submit conflicts (all buttons type="button")
- Event listeners bound after DOM ready
- No reliance on event delegation for critical actions
- Touch-friendly button targets

## 5. iOS Caching & Stats UI ✅

### Changes Made:
- **Bank Stats**: Computed from `window.BANKS` (not localStorage)
- **Update Trigger**: `updateBankStats()` called after:
  - Initial load
  - Reload Banks
  - Section completion
  
- **Error Messages**: Show exact failing URL/status:
  - "❌ Failed to load banks: Bank HTTP 404: ./data/bank_quant.json (Quant)"
  - "❌ Failed to load banks: Quant bank is empty or invalid"

### Netlify Configuration:
Already configured in `netlify.toml`:
```toml
[[headers]]
  for = "/data/*.json"
  [headers.values]
    Cache-Control = "no-store"
```

## Testing Checklist

### Desktop (Chrome/Firefox/Edge):
- [ ] Reload Banks shows correct counts (1500/1500 or actual totals)
- [ ] Choose section order, Start Practice → sections run in order
- [ ] No duplicate questions within any section
- [ ] Full test auto-advances between sections
- [ ] Individual section buttons work
- [ ] Exposure control prevents repeats across sessions

### Mobile (iOS Safari 15+):
- [ ] Reload Banks loads successfully (no 0/0)
- [ ] Shows exact error if fetch fails
- [ ] Section order works identically to desktop
- [ ] No duplicate questions within sections
- [ ] Touch interactions work on all buttons
- [ ] Calculator works (Data Insights only)
- [ ] Timer displays correctly
- [ ] No console errors related to events

### Edge Cases:
- [ ] Bank exhausted → shows warning, uses remaining items
- [ ] Toggle Exposure Control ON → respects used IDs
- [ ] Reset Exposure → allows all questions again
- [ ] Reload Banks (forced) → bypasses all caches
- [ ] Full test interruption → can resume/restart cleanly

## Code Quality

### ES2019 Compliance:
- ✅ No arrow functions with void 0 defaults
- ✅ No optional chaining
- ✅ No nullish coalescing
- ✅ No Array.prototype.at()
- ✅ No Object.fromEntries()
- ✅ Manual loops over .forEach() where needed

### Performance:
- Single fetch per bank file
- Efficient Set-based duplicate checking
- No redundant re-renders
- Minimal DOM manipulation

### Robustness:
- Explicit error handling at every async boundary
- User-visible error messages
- No silent failures
- Graceful degradation when banks fail

## Files Modified

1. **app.js** - Complete rewrite (1,400+ lines)
   - Bank loader
   - Section order system
   - Sampler with uniqueness
   - Event wiring
   - All business logic

2. **index.html** - Button updates
   - 24 buttons: Added `type="button"`
   - No structural changes
   - IDs remain consistent

3. **netlify.toml** - No changes needed
   - Already configured correctly

## Migration Notes

### Breaking Changes:
- **State Storage**: Banks now in `window.BANKS` instead of `APP_STATE.questionBanks`
- **Sampler**: Old `sampleQuestions()` replaced with `assembleSection()`
- **Start Functions**: `startSession()` replaced with `startFullTest()` and `startSingle()`

### Backward Compatibility:
- ✅ localStorage format unchanged
- ✅ History format unchanged
- ✅ Settings preserved
- ✅ Exposure tracking preserved

## Known Limitations

1. **Auto-advance timing**: Fixed 3-second delay between sections
   - Future: Make configurable or add "Continue" button
   
2. **Full test interruption**: Cannot pause mid-test
   - Each section completes independently
   - Future: Add pause/resume

3. **Difficulty distribution**: Fixed 30/50/20 split
   - Works well for balanced banks
   - Future: Make configurable per section

## Support

For issues or questions:
1. Check browser console for detailed error logs
2. Try "Reload Banks" with force refresh
3. Verify JSON files are accessible
4. Check Netlify headers are deployed
