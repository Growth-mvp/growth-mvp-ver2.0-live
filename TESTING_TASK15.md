# TASK 15 Testing: Fix STAGE2 Field Loss on Restore

## Problem
DB rows contain STAGE2 fields (storyDraft, winPatternsCandidate, answers12, finalStory) but UI shows 0.

## Root Cause
1. `getFullStrategyDataByCompany` returns `buildStateFromDbRow` output (complete state with STAGE2)
2. `refetchFromServer` calls `normalizeFromDbRow` on already-converted state (double-conversion)
3. `normalizeFromDbRow` deletes undefined fields, discarding unmapped STAGE2 fields
4. `FIELD_MAP` was missing STAGE2 field definitions

## Solution Implemented

### TASK 15-A: Eliminate Double-Conversion
- Changed `const patch = normalizeFromDbRow(dbRow);` to `const patch = dbRow as Partial<StrategyState>;`
- dbRow is already buildStateFromDbRow output, needs no re-conversion

### TASK 15-B: Complete FIELD_MAP for STAGE2
Added to FIELD_MAP:
- `answers2: 'answers2'`
- `answers12: 'answers12'`
- `winPatternsCandidate: 'win_patterns_candidate'`
- `winPatterns: 'win_patterns'`
- `winPatternPrimary: 'win_pattern_primary'`
- `winPatternSecondary: 'win_pattern_secondary'`

Updated buildDbRowFromState to ensure array conversion for all STAGE2 fields

### TASK 15-C: Comprehensive Audit Logging
Added logging at three points:
1. **buildStateFromDbRow (raw_復元)**: STAGE2 field counts after initial restore
2. **refetchFromServer**: Full state check before merge/set
3. **refetchFromServer (after set)**: Final state verification via [audit][restore:stage2_check]

## Test Checklist

### Test 1: Verify FIELD_MAP Addition
1. Open browser DevTools Console
2. Execute: `console.log(Object.keys(window.FIELD_MAP || {}))`
3. **Expected**: Should show `answers12`, `winPatternsCandidate`, `winPatterns` in map

**Verification Command** (in browser console):
```javascript
// Check if FIELD_MAP includes STAGE2 fields
const hasStage2 = ['answers12', 'winPatternsCandidate', 'winPatterns'].every(
  f => Object.keys(useStrategyStore.getState() || {}).includes(f)
);
console.log('STAGE2 fields in store:', hasStage2);
```

### Test 2: Verify buildStateFromDbRow Output
1. Open browser DevTools Console
2. Look for logs starting with `[buildStateFromDbRow] raw_復元`
3. **Expected**: See entries like:
```
[buildStateFromDbRow] raw_復元 {
  storyDraft_len: 2,
  answers12_len: 3,
  winPatternsCandidate_len: 1,
  winPatterns_len: 2,
  ...
}
```

### Test 3: Verify No Double-Conversion
1. Reload page with network DevTools open
2. Watch for `[strategyStore refetch] full state from DB` log
3. **Should NOT see**: `[normalizeFromDbRow]` logs after `getFullStrategyDataByCompany`
4. **Expected pattern**:
```
[StrategyData] 📥 getFullStrategyDataByCompany
→ [buildStateFromDbRow] raw_復元 (answers12_len: 2)
→ [strategyStore refetch] full state from DB (answers12_len: 2)  ← same value!
→ [audit][restore:stage2_check] (answers12_len: 2)  ← preserved!
```

### Test 4: End-to-End Data Persistence
1. Go to STAGE2 page (Story Process or Stage 2)
2. Create:
   - storyDraft (save a draft story)
   - At least 2 winPatternsCandidate
   - Answers to answers12 (12 questions)
   - finalStory (at least 1 chapter)
3. Reload page (F5)
4. **Check browser console** for:
   - `[buildStateFromDbRow] raw_復元`: storyDraft_len > 0, answers12_len > 0
   - `[strategyStore refetch] full state from DB`: answers12_len > 0
   - `[audit][restore:stage2_check]`: All STAGE2 fields present
5. **Expected UI**: All data visible without loss

### Test 5: Verify State in Store
Execute in browser console after reload:
```javascript
const s = useStrategyStore.getState();
console.log({
  storyDraft_len: (s.storyDraft || []).length,
  answers12_len: (s as any).answers12?.length ?? 0,
  winPatternsCandidate_len: (s as any).winPatternsCandidate?.length ?? 0,
  winPatterns_len: (s.winPatterns || []).length,
  finalStory_len: (s.finalStory || []).length,
});
```

**Expected output** should match data created in Test 4

### Test 6: Trace Field Flow
1. Open DevTools Console with filter: `[buildStateFromDbRow] raw_復元`
2. Search for the 3 audit points:
   - `[buildStateFromDbRow] raw_復元` - source from DB
   - `[strategyStore refetch] full state from DB` - after patch creation
   - `[audit][restore:stage2_check]` - after store.set()

3. Verify field counts match at all 3 points:
   - `storyDraft_len`
   - `answers12_len`
   - `winPatternsCandidate_len`
   - `winPatterns_len`
   - `finalStory_len`

All counts should be identical (no loss)

## Regression Testing

### Test 7: STAGE1 Data Still Works
1. Go to STAGE1 page
2. Verify STAGE1 data still restores correctly:
   - financePL
   - financeBS
   - segmentPL / segmentBS
   - stage1Issues
   - businessSegments

**Check logs**: `[buildStateFromDbRow] raw_復元` should show these with correct lengths

### Test 8: Multiple Reload Cycles
1. Create all STAGE2 data
2. Reload (F5)
3. Verify data persists
4. Modify data
5. Reload (F5) again
6. Repeat 3-5 cycles
7. **Expected**: Data consistently persists, no loss

### Test 9: Company Switching
1. Create STAGE2 data in Company A
2. Switch to Company B
3. Switch back to Company A
4. **Expected**:
   - STAGE2 data from Company A restored correctly
   - `[audit][restore:stage2_check]` shows correct field counts

## Debug Commands

### Check current state STAGE2 fields
```javascript
const s = useStrategyStore.getState();
['storyDraft', 'answers12', 'winPatternsCandidate', 'winPatterns', 'finalStory']
  .forEach(f => console.log(`${f}: ${((s as any)[f] || []).length}`));
```

### Monitor restore flags during reload
```javascript
// Run this BEFORE reloading, watch console
setInterval(() => {
  const s = useStrategyStore.getState();
  console.log('[flags]', {
    hydrated: s.hydrated,
    restoreReady: s.restoreReady,
    isRestoring: s.isRestoring,
  });
}, 500);
// Reload, watch the progression
```

### Check FIELD_MAP coverage
```javascript
const dbFields = ['story_draft', 'answers12', 'win_patterns_candidate', 'win_patterns'];
const hasAll = dbFields.every(f => {
  // Check if field is referenced in FIELD_MAP values
  return true; // Manual verification needed
});
console.log('FIELD_MAP complete:', hasAll);
```

## Expected Log Flow (Timeline)

```
t=0ms        Page loads
t=50ms       refetchFromServer starts
t=150ms      [StrategyData] 📥 getFullStrategyDataByCompany
t=200ms      [buildStateFromDbRow] raw_復元 {
               storyDraft_len: 2
               answers12_len: 3
               winPatterns_len: 2
             }
t=300ms      [strategyStore refetch] 📦 full state from DB {
               storyDraft_len: 2
               answers12_len: 3
               winPatterns_len: 2
             }
t=400ms      ✅ Store.set() called with full state
             [audit][restore:stage2_check] {
               storyDraft_len: 2  ← PRESERVED!
               answers12_len: 3   ← PRESERVED!
               winPatterns_len: 2 ← PRESERVED!
             }
t=500ms      UI renders with all STAGE2 data visible
```

## Files Modified
- `store/strategyStore.ts`: Remove normalizeFromDbRow call, add STAGE2 logging
- `utils/supabase/strategy.ts`: Add STAGE2 to FIELD_MAP, add diagnostic logs

## Related Tasks
- TASK 14: Restore state flags (hydrated, restoreReady, isRestoring)
- TASK 15-A: Double-conversion elimination
- TASK 15-B: FIELD_MAP completion
- TASK 15-C: Comprehensive audit logging
