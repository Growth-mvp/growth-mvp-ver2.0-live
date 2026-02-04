# TASK 16 Testing: Consolidate Stage2 Data to Store-Only

## Problem
Local state and store were managing STAGE2 fields separately, causing data loss and complexity.

## Solution Implemented

### Removed Local State
Deleted `useState` declarations:
- `const [storyDraft, setStoryDraft]`
- `const [winPatternsCandidate, setWinPatternsCandidate]`
- `const [finalStory, setLocalFinalStory]`
- `const [answers12, setLocalAnswers12]`

### Added Store Selectors
```typescript
const storyDraft = useStrategyStore(s => s.storyDraft ?? []);
const setStoryDraft = useStrategyStore(s => s.setStoryDraft);

const winPatternsCandidate = useStrategyStore(s => s.winPatternsCandidate ?? []);
const setWinPatternsCandidate = useStrategyStore(s => s.setWinPatternsCandidate);

const finalStory = useStrategyStore(s => s.finalStory ?? []);
const setLocalFinalStory = useStrategyStore(s => s.setFinalStory); // alias

const answers12 = useStrategyStore(s => s.answers12 ?? []);
const setLocalAnswers12 = useStrategyStore(s => s.setAnswers12);
```

### Data Flow After Consolidation
```
DB restore
  ↓
buildStateFromDbRow (TASK 15)
  ↓
store.set() [via refetchFromServer]
  ↓
store selectors (TASK 16)
  ↓
UI components
```

No local state interception.

## Test Checklist

### Test 1: Verify Local State Removed
1. Open browser DevTools Console
2. Execute: `console.log('storyDraft' in window)`
3. **Expected**: false (no global storyDraft)
4. Execute: `useStrategyStore.getState().storyDraft`
5. **Expected**: Array (from store, not undefined)

### Test 2: Verify Store Selectors
1. Go to STAGE2 page
2. In console, execute:
```javascript
const s = useStrategyStore.getState();
console.log({
  storyDraft_len: (s.storyDraft || []).length,
  winPatternsCandidate_len: (s as any).winPatternsCandidate?.length ?? 0,
  finalStory_len: (s.finalStory || []).length,
  answers12_len: (s as any).answers12?.length ?? 0,
});
```
3. **Expected**: All values from store (not undefined)

### Test 3: Restore Flow (TASK 15 + TASK 16)
1. Create STAGE2 data (storyDraft, winPatternsCandidate, finalStory, answers12)
2. Reload page (F5)
3. Watch browser console for:
   - `[buildStateFromDbRow] raw_復元`: storyDraft_len > 0
   - `[strategyStore refetch] full state from DB`: storyDraft_len > 0
   - `[audit][restore:stage2_check]`: STAGE2 fields preserved
   - `[Stage2][ui_check]`: storyDraftLen > 0 (store value)
4. **Verify logs match**:
   - buildStateFromDbRow storyDraft_len === strategyStore refetch storyDraft_len === ui_check storyDraftLen
5. **Expected UI**: All data visible without loss

### Test 4: Generate Creates Store-Only Data
1. Go to STAGE2 input tab
2. Enter MVV/SWOT, click "DRAFT生成"
3. Watch console for:
   - `[Stage2] API response winPatternsCandidate count: X`
   - `[Stage2] Generated data set to store`: storyDraft_len > 0, winPatterns_len > 0
4. **Verify**: Data appears in DraftStoryPanel and WinPatternList immediately
5. **Execute in console**: `useStrategyStore.getState().storyDraft.length`
6. **Expected**: Matches displayed count

### Test 5: UI Components Receive Store Values
Inspect props in DevTools React tab:
1. Find `<DraftStoryPanel>` component
2. Check props: `storyDraft` should be store array
3. Find `<WinPatternList>` component
4. Check props: `candidates` should be store array
5. Find `<FinalStoryPreview>` component
6. Check props: `finalStory` should be store array
7. **Expected**: All props reference store selectors (not local state)

### Test 6: Snapshot Restore Uses Store
1. Create STAGE2 data
2. Save to localStorage snapshot (`saveStage2SnapshotToLocalStorage`)
3. Clear store manually: `useStrategyStore.setState({storyDraft: []})`
4. Trigger restore: `restoreStage2Snapshot()`
5. **Verify console logs**:
   - `[Stage2] snapshot.storyDraft lengths: Ch0: XXXchars`
   - After restore, `useStrategyStore.getState().storyDraft.length > 0`
6. **Expected UI**: Data restored and visible

### Test 7: Generate Final Updates Store
1. Go to STAGE2 "勝ち筋" tab
2. Click "最終ストーリー生成"
3. Watch console for:
   - API response with finalStory
   - `[Stage2] Generated finalStory set to store`: finalStory_len > 0
4. Check store: `useStrategyStore.getState().finalStory.length`
5. **Expected**: finalStory in store matches UI display

### Test 8: No Duplicate Setter Calls
1. Open console with filter: `setStoryDraft\|setWinPatternsCandidate\|setFinalStory`
2. Generate STAGE2 data ("DRAFT生成")
3. **Should NOT see**: Duplicate console.log or duplicate setter calls
4. **Expected**: Each setter called once per generate action

### Test 9: UI Check Log Matches DB Restore Log
**Timeline verification:**
```
TASK 15 (DB restore):
[buildStateFromDbRow] raw_復元 {
  storyDraft_len: 2,
  answers12_len: 3,
  winPatterns_len: 2
}

TASK 16 (UI render):
[Stage2][ui_check] {
  storyDraftLen: 2,  ← MUST MATCH
  ...
}
```

1. Create data
2. Reload page
3. Compare logs:
   - Find `[buildStateFromDbRow] raw_復元` log
   - Note `storyDraft_len: X`
   - Find `[Stage2][ui_check]` log
   - Verify `storyDraftLen: X` matches
4. **Expected**: Exact match (no data loss)

### Test 10: Multiple Reload Cycles
1. Create STAGE2 data
2. Reload (F5) and verify [ui_check] log matches [buildStateFromDbRow]
3. Modify data in UI
4. Reload (F5) again and verify match
5. Repeat 3-4 times
6. **Expected**: Consistent matching logs, no data loss

## Regression Tests

### Test 11: Existing Features Still Work
1. STAGE1 data still restores
2. SWOT suggestions still work
3. Snapshot save/restore works
4. DB save works

### Test 12: All Components Render
1. DraftStoryPanel renders with store data
2. WinPatternList renders with store data
3. FinalStoryPreview renders with store data
4. All tabs (input, draft, candidates, final) accessible

## Debug Commands

### Check all STAGE2 values in store
```javascript
const s = useStrategyStore.getState();
console.table({
  storyDraft: (s.storyDraft || []).length,
  winPatternsCandidate: (s as any).winPatternsCandidate?.length ?? 0,
  finalStory: (s.finalStory || []).length,
  answers12: (s as any).answers12?.length ?? 0,
  ceoIntent: typeof (s as any).ceoIntent === 'string' ? s.ceoIntent.length : 0,
});
```

### Monitor restore flow
```javascript
// Before reload, watch logs:
// 1. [buildStateFromDbRow] raw_復元
// 2. [strategyStore refetch] full state from DB
// 3. [audit][restore:stage2_check]
// 4. [Stage2][ui_check]
// All should have matching field lengths
```

### Verify no local state in component
```javascript
// In any React component using useStrategyStore:
// const storyDraft = ... should directly reference store
// NOT: const [storyDraft, setStoryDraft] = useState(...)
```

## Expected Log Flow

```
t=0ms        Page reload
t=100ms      refetchFromServer starts
t=200ms      [buildStateFromDbRow] raw_復元 {
               storyDraft_len: 2
               answers12_len: 3
             }
t=300ms      [strategyStore refetch] full state from DB {
               storyDraft_len: 2  ← MATCH
               answers12_len: 3   ← MATCH
             }
t=400ms      [audit][restore:stage2_check] {
               storyDraft_len: 2  ← MATCH
               answers12_len: 3   ← MATCH
             }
t=500ms      Component renders (store selectors trigger)
             [Stage2][ui_check] {
               storyDraftLen: 2   ← MATCH
             }
t=600ms      UI shows all STAGE2 data ✅
```

## Files Modified
- `/app/stage2/page.tsx`: Replace local state with store selectors

## Related Tasks
- TASK 14: Restore state flags
- TASK 15: STAGE2 field mapping (FIELD_MAP)
- TASK 16: Store consolidation (this task)

## Expected Outcome
All STAGE2 data flows through store only:
- DB restore → store
- Generate → store
- Snapshot restore → store
- UI render reads store
- No local state interference
