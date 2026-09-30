# STAGE6 Phase E - Regression Tests (v1.1)

## Overview

This document describes minimal regression tests for STAGE6 Phase E functionality. These tests ensure that core calculations remain stable and don't break when Phase E data is modified.

## Acceptance Criteria

All three test cases must pass before deploying Phase E v1.1 updates.

---

## Test Case 1: Unit-Specific Achievement Rate

**Purpose**: Verify that achievement rates are NOT calculated as abnormal percentages (e.g., 333,333%) when units differ.

**Setup**:
1. Go to STAGE6 Tab2 (North Star)
2. Find a North Star row with unit = "百万円" (millions of yen)
3. Note the current base value and forecast value

**Action**:
1. Open the row expansion by clicking "編集" button
2. Input a delta value (e.g., +100百万円)
3. Observe the forecast and achievement rate update

**Expected Result**:
- ✅ Forecast value updates correctly (base + delta)
- ✅ Achievement rate is reasonable (e.g., between 50-200%, not 10,000%+)
- ✅ No NaN or Infinity values displayed
- ✅ Gap calculation reflects the new forecast correctly

**Debug Check**:
```
In browser console with NEXT_PUBLIC_DEBUG_STAGE6=1:
[J-2] unitNormalized: {
  label: "売上"
  unit: "百万円"
  forecastValue: <reasonable number>,
  achievementRate: <reasonable percentage>
}
```

---

## Test Case 2: Hybrid Phase E (Single Impact)

**Purpose**: Verify that entering Phase E impacts on only ONE North Star row does NOT break other rows' forecasts.

**Setup**:
1. Go to STAGE6 Tab2 (North Star)
2. Take a screenshot of all North Star rows (noting forecastValue for all)

**Action**:
1. Open expansion on the first North Star row
2. Enter a delta for ONE project (e.g., +50)
3. Close expansion
4. Scroll and observe all other rows

**Expected Result**:
- ✅ First row: forecast/gap/achievement changes (correct)
- ✅ Other rows: forecast/gap/achievement UNCHANGED (critical!)
- ✅ No rows show NaN or error states
- ✅ Tab2 chart and table still match on 売上/営業利益 endpoints

**Debug Check**:
```
In browser console with NEXT_PUBLIC_DEBUG_STAGE6=1:
[E-3] Hybrid: <total rows> rows, <N> rows with PhaseE overwrite
```

Should show that only the affected row count matches the number you edited.

---

## Test Case 3: Issue Resolution Without North Star Linkage

**Purpose**: Verify that Issue resolution rates update based on project strength/execution even WITHOUT North Star metric linkage.

**Setup**:
1. Go to STAGE6 Tab3 (Value Analysis)
2. Find an Issue card that shows "未接続" (unconnected) or empty linkedTargets
3. Note the current resolution rate

**Action**:
1. Open the Issue expansion by clicking "プロジェクト紐付け編集"
2. Select a project and set strength to "強" (3)
3. Close expansion
4. Observe the Issue card

**Expected Result**:
- ✅ Resolution rate updates (moves from 0% toward higher percentage)
- ✅ Issue card shows "効いているプロジェクト（Top3）" section
- ✅ Shows: "プロジェクト名 strength 強(1.3) × weight XX% = YY"
- ✅ No "未接続" warning appears (or shows helpful note instead)
- ✅ Strength coefficient explanation displayed: "弱=0.6 / 中=1.0 / 強=1.3"

**Debug Check**:
```
In browser console with NEXT_PUBLIC_DEBUG_STAGE6=1:
[F-1] Phase E Issues: <number of issues>件計算
```

---

## Pre-Deployment Checklist

Before merging Phase E v1.1:

- [ ] `npm run type-check` passes (0 errors)
- [ ] `npm run build` passes (0 errors, all pages generate)
- [ ] Test Case 1 passes on local dev: `NEXT_PUBLIC_DEBUG_STAGE6=1 npm run dev`
- [ ] Test Case 2 passes on local dev
- [ ] Test Case 3 passes on local dev
- [ ] Tab2 chart endpoints match table forecast (売上/営業利益)
- [ ] Unit warning messages appear/disappear appropriately with delta inputs
- [ ] Save and reload: Phase E data persists (impacts/links remain after page reload)

---

## Known Limitations (v1.1)

1. **Contribution parameter**: Fixed at 1.0 for all projects (reserved for future OKR-based scaling)
2. **Baseline**: Fixed at 0 for all targets (reserved for historical baseline linking)
3. **Strength coefficients**: Fixed mapping (弱=0.6, 中=1.0, 強=1.3) - not customizable per issue
4. **Max normalization**: Issue resolution uses global max-score normalization (all issues share same scale)

---

## Debugging Tips

### Enable Debug Logging

```bash
# Terminal
NEXT_PUBLIC_DEBUG_STAGE6=1 npm run dev
```

Then check browser DevTools Console for:
- `[G-1]` - CompanyTargets unit/base samples
- `[E-2]` - Chart data sync (売上/営業利益)
- `[E-3]` - Hybrid Phase E row overwrites
- `[J-2]` - Unit normalization & Phase E stats
- `[F-1]` - Issue resolution calculation count

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Achievement rate > 10,000% | Unit normalization not applied | Check `normalizeValueToUnit()` in compute.ts |
| Delta input doesn't change forecast | Phase E data not saved | Check browser DevTools Network tab for save errors |
| Issue resolution stuck at 0% | No projectIssueLinks created | Verify strength link was added in Tab3 expansion |
| Warning shows on every delta | Unit threshold wrong | Check unit-specific thresholds in TabNorthStar.tsx line ~343 |

---

## Files Modified in v1.1

- `utils/stage6/types.ts` - Added breakdown fields
- `utils/stage6/compute.ts` - Unit normalization utility
- `utils/stage6/phaseE.ts` - Breakdown details in results
- `components/stage6/hooks/useStage6Data.ts` - Enhanced logging
- `components/stage6/TabNorthStar.tsx` - H-1, H-2 (breakdown display + unit warnings)
- `components/stage6/TabValue.tsx` - I-1, I-2 (contributors + strength coefficients)
- `store/strategyStore.ts` - J-1 (sanitization before save)

---

## Next Steps (Future Versions)

- [ ] v1.2: Custom strength coefficients per issue type
- [ ] v2.0: OKR-based contribution multipliers
- [ ] v2.0: Historical baseline integration
- [ ] v3.0: Cross-project dependency analysis
