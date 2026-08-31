# STAGE4 (OKR Page) Dirty Flag False Positive Diagnosis

## Investigation Summary

**Status**: Root cause analysis in progress

**Key Finding**: STAGE4 OKR page (`app/okr/page.tsx`) does NOT display "未保存の変更あり" itself. However, STAGE4's restore process appears to trigger the false positive in STAGE3 when the user navigates back.

## STAGE4 Architecture

### Pages Involved
- **STAGE3**: `/app/cascade/page.tsx` - Has "未保存の変更あり" indicator
- **STAGE4**: `/app/okr/page.tsx` - OKR editing, NO "未保存の変更あり" display
- **Transition**: STAGE3 ↔ STAGE4 navigation

### Snapshot Structure (Same as STAGE3)
Located at: `/app/okr/page.tsx` lines 190-215

```typescript
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId, story, finalStory, answers2, departments, companyName,
    mission, vision, value, thought
  };
  // Conditionally add: csvFinanceData, financeSummary, businessPortfolio, simulationResult
  return snap;
}

function hashSnapshot(obj: any) {
  // DJB2 hash algorithm (same as STAGE3)
}
```

**Field Count**: 13 core fields (same limited scope as STAGE3)

### Baseline Creation Pattern (Unique to STAGE4)
Located at: `/app/okr/page.tsx` lines 635-665

```typescript
const baselineCreatedRef = useRef<boolean>(false);

useEffect(() => {
  if (!hydrated || isHydrating || !accessCompanyId || baselineCreatedRef.current) return;

  // Check if baseline already exists for this company
  if (executionPlanBaseline?.snapshot && executionPlanBaseline.companyId === accessCompanyId) {
    baselineCreatedRef.current = true;
    return;
  }

  // Create baseline: departments full deep copy
  const baseline = {
    companyId: accessCompanyId,
    createdAt: Date.now(),
    snapshot: JSON.parse(JSON.stringify(departments))  // ← Deep copy
  };

  setExecutionPlanBaseline?.(baseline);
  baselineCreatedRef.current = true;
}, [hydrated, isHydrating, accessCompanyId, executionPlanBaseline, departments, setExecutionPlanBaseline]);
```

**Key Points**:
- Line 660: baseline stores deep copy of `departments` at hydration completion
- Line 665: `departments` is a dependency - effect re-runs if departments changes
- Line 649: baselineCreatedRef guard prevents re-execution (2nd+ time)
- **However**: If departments changes AFTER baseline creation, baseline becomes stale

## Initial Load Sequence (STAGE4)

### Step 1: Page Mount (lines 383-443)
```
T0: useEffect triggered (accessCompanyId, hydrated, etc.)
T1: refetchFromServer() called (always executes)
    └─→ Store: departments updated from DB patch
    └─→ Store: lastServerSnapshot = hash(buildSavePayload) [50+ fields]
T2: setHydrated(true) called
T3: React renders after hydrated changes
```

### Step 2: Baseline Creation (lines 648-665)
```
T3.5: useEffect for baseline creation triggered
      Dependencies: hydrated=true, departments (from T1)
T4: Baseline snapshot = JSON.parse(JSON.stringify(departments))
T5: setExecutionPlanBaseline(baseline)
T6: baselineCreatedRef.current = true (prevents re-run)
```

### Step 3: Auto-save Guard (lines 449-456)
```
useAutoSave({
  enabled: false,  // ← STAGE4 disables autosave
  ...
})
```

## Critical Mismatch: Store vs Page Snapshot

### Store's buildSavePayload (strategyStore.ts:769+)
```
50+ fields:
- STAGE1: financeBS, financePL, segmentPL, segmentBS, csvFinanceData, businessPortfolio
- STAGE2: story, finalStory, answers2, answers12, storyDraft, winPatterns, ceoIntent, SWOT
- STAGE3: departments, mission, vision, value, thought
- STAGE4: stage4Plans, executionPlanBaseline
- STAGE6: projectTargetImpacts, okrTargetScores, projectIssueLinks
- And more...
```

### STAGE4's makeSaveSnapshot
```
13 fields:
- strategyId, story, finalStory, answers2, departments, companyName
- mission, vision, value, thought
- conditionally: csvFinanceData, financeSummary, businessPortfolio, simulationResult
```

## Restore Flow in Store

### wasDirty=false Path (Initial Load)
Location: `strategyStore.ts` lines 4120-4167

```typescript
// Line 4124-4142: FULL REPLACEMENT merge
set((s) => {
  const merged: any = {
    ...(s as any),          // base (auxiliary)
    ...(patch as any),      // DB fresh data overwrites
    companyId: s.pendingCompanyId ?? s.companyId,
    pendingCompanyId: undefined,
  };
  return merged as StrategyState;
});

// Line 4145-4146: Compute baseline hash from full payload
const after = get();
const snapshot = buildSavePayload(after as StrategyState);  // 50+ fields
const hash = stableHash(snapshot);

// Line 4149-4161: Set lastServerSnapshot from buildSavePayload hash
set({
  serverShadow: snapshot,
  lastServerSnapshot: hash,  // ← MISMATCH: hash from 50+ fields
  __isFetchingFromServer: false,
  loaded: true,
  __lastSavedHash: hash,
  dirty: false,
  restoreReady: true,
  isRestoring: false,
  lastServerSyncAt: Date.now(),
});

// Line 4167: Call setHydrated with hash
get().setHydrated(rev, hash);
```

## Timeline: STAGE4 Open → STAGE3 Return

### Scenario: User opens STAGE3, edits, saves (dirty=false)
```
[STAGE3]
T0: Page load
T1: refetchFromServer() in store
    └─→ lastServerSnapshot = hash(buildSavePayload) [50+ fields]
    └─→ departments = DB data
T2: hasUnsavedChanges = false (because snapshots match)
T3: "未保存の変更あり" = NOT displayed ✓

[STAGE3 → STAGE4 Navigation]
T4: User clicks to go to OKR
T5: STAGE4 mounts, refetchFromServer() called (again)
    └─→ store departments might be re-fetched or re-set
T6: Baseline created in STAGE4 (separate tracking)

[STAGE4 → STAGE3 Navigation]
T7: User returns to STAGE3
T8: STAGE3 re-mounts or re-renders
T9: hasUnsavedChanges calculation:
    - currentSnapshotHash = hash(makeSaveSnapshot[13 fields])
    - compare against lastServerSnapshot from T1/T5 [50+ fields]
    - MISMATCH! → hasUnsavedChanges = true ✗
```

## Root Cause Analysis

### Hypothesis 1: Same Snapshot Structure Mismatch (Most Likely)
- **Status**: SUPPORTED
- **Evidence**:
  - STAGE4 restore sets `lastServerSnapshot = hash(buildSavePayload with 50+ fields)`
  - STAGE3 compares against `currentSnapshotHash = hash(makeSaveSnapshot with 13 fields)`
  - These hashes will NEVER match for identical data
- **Why STAGE4 is Primary**:
  - STAGE4's refetchFromServer() is always executed
  - This always resets `lastServerSnapshot` with buildSavePayload hash
  - Each STAGE4 visit reinforces the mismatch baseline
- **Why User Sees It in STAGE4 Context**:
  - User navigates STAGE3 → STAGE4 → STAGE3
  - STAGE4's restore reinforces the buildSavePayload baseline
  - STAGE3 dirty calculation then always fails

### Hypothesis 2: Baseline Timing Issues (Less Likely)
- **Status**: POSSIBLE but lower priority
- **Observation**: STAGE4 baseline is created from current `departments` after restore
- **Issue**: If departments is set multiple times during restore, baseline might capture intermediate state
- **But**: baselineCreatedRef guard should prevent re-creation
- **Verdict**: Less likely to be primary cause

## Expected False Positive Flow

```
1. Initial Load (STAGE3 or STAGE4)
   └─→ restore completes
   └─→ lastServerSnapshot = hash(buildSavePayload) [50+ fields]

2. Page Display
   └─→ currentSnapshotHash = hash(makeSaveSnapshot) [13 fields]
   └─→ Comparison: lastServerSnapshot !== currentSnapshotHash
   └─→ Result: hasUnsavedChanges = true (FALSE POSITIVE)

3. After Manual Save
   └─→ autosave or saveNow() triggered
   └─→ Store update (dirty check with same snapshot functions)
   └─→ lastServerSnapshot updated to match currentSnapshotHash
   └─→ Result: hasUnsavedChanges = false (CORRECT)

4. Navigation Away & Back
   └─→ If revisiting without restore: baselineRemains
   └─→ If refetchFromServer() called: lastServerSnapshot resets to buildSavePayload hash
   └─→ Back to step 2: false positive recurs
```

## Key Code Sections

| File | Lines | Purpose |
|------|-------|---------|
| okr/page.tsx | 190-215 | makeSaveSnapshot & hashSnapshot (13 fields) |
| okr/page.tsx | 383-443 | Initial load & refetchFromServer |
| okr/page.tsx | 648-665 | Baseline creation with deep copy |
| strategyStore.ts | 769+ | buildSavePayload (50+ fields) |
| strategyStore.ts | 4120-4167 | wasDirty=false restore path |
| cascade/page.tsx | 1945-1950 | hasUnsavedChanges comparison |

## Diagnosis Summary for User

### What Happens
1. **STAGE4 restore** sets `lastServerSnapshot` using `buildSavePayload()` (50+ fields)
2. **STAGE3 dirty check** compares against `makeSaveSnapshot()` (13 fields)
3. **Hashes never match** → false "未保存の変更あり"
4. **Save resets baseline** → temporarily fixes it
5. **Navigation to STAGE4** → restores false baseline again
6. **Pattern repeats** → every STAGE4 visit re-triggers false positive

### Root Cause
Same as STAGE3: **Snapshot structure mismatch between store (buildSavePayload) and page (makeSaveSnapshot)**

However, STAGE4 is the PRIMARY trigger because:
- refetchFromServer() is always executed
- This always resets lastServerSnapshot with 50+ field hash
- Each navigation to STAGE4 reinforces the misaligned baseline

### Solution Options (Same as STAGE3 + 1 Additional)

**Option A: Sync snapshot structures** ← Primary solution
- Modify both makeSaveSnapshot() functions to match
- Ensure store and pages use same field set
- Requires testing both STAGE3 & STAGE4

**Option B: Implement baseline pattern in STAGE3** ← Secondary
- Copy STAGE4's baselineCreatedRef approach
- Create baseline after restore, not from server data
- Isolate STAGE3's dirty calculation from store

**Option C: Set lastServerSnapshot to makeSaveSnapshot hash**
- After restore, recalculate hash using makeSaveSnapshot only
- Single-point fix in store
- Risk: might miss real changes if buildSavePayload fields are important

**Option D: Disable lastServerSnapshot check in STAGE3** ← Workaround only
- Use baseline pattern instead
- Don't rely on store's lastServerSnapshot
- Safer isolation

## Confirmation Needed

To confirm this diagnosis, user should check:

1. ✓ STAGE4 has baselineCreatedRef pattern (confirmed)
2. ✓ Both pages use same makeSaveSnapshot (confirmed - 13 fields)
3. ? Store's buildSavePayload is larger (confirmed - 50+ fields)
4. ? Restoration always sets lastServerSnapshot = buildSavePayload hash (confirmed)
5. ? STAGE3 compares against 13-field hash (confirmed)
6. ? FALSE POSITIVE occurs on every STAGE4 visit (assumed - user reports this)

## Next Steps

1. **Implement fix in STAGE3** first (simpler, isolated)
2. **Test both pages** thoroughly
3. **Verify STAGE4 behavior** doesn't regress
4. **Consider unified snapshot policy** for all pages long-term
