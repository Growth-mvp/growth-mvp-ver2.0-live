# TASK 14 Testing: Fix Data Loss on Reload

## Problem
On reload, user data in the following areas would disappear:
- DRAFT story (storyDraft)
- Win Patterns (winPatterns)
- 12 Questions (answers12)
- Final Story (finalStory)

## Root Cause
1. **persist middleware** was restoring old localStorage data
2. **DB restore** (refetchFromServer) was happening after persist rehydrate
3. **canSave logic** was not gating saves until restore completed
4. **Old storage key** meant stale data was being restored

## Solution Implemented

### 1. Restore State Flags
Added to `StrategyState`:
- `hydrated`: true when localStorage restoration is complete
- `restoreReady`: true when DB restoration is complete
- `isRestoring`: true while DB restore is in progress

### 2. Save Gate
Added `canSave` check in `saveStrategyData`:
```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}
```

### 3. Storage Key Upgrade
Changed persist storage key:
- Old: `'strategy-store'` (version 36)
- New: `'strategy-store-v5'` (version 37)
- Effect: All old localStorage data is ignored

### 4. Restore Sequence Control
- **persist hydrate** sets `hydrated=true`
- **refetchFromServer** sets `restoreReady=true` and `isRestoring=false`
- **Saves blocked** until both flags are true

## Testing Checklist

### Test 1: Basic Data Persistence
1. Go to STAGE2 or Story Process page
2. Create:
   - Story Draft (storyDraft)
   - At least one Win Pattern (winPatterns)
   - Answers to 12 Questions (answers12)
   - Final Story (finalStory)
3. Reload the page (F5)
4. **Expected**: All data is still visible
5. **Check browser console**: Look for `[audit][saveStrategyData]` logs showing restore flags

### Test 2: Monitor Restore Flags
1. Open browser DevTools Console
2. Execute: `useStrategyStore.getState()`
3. Check these flags **before** and **after** reload:
   - `hydrated`: should be false → true (after persist rehydrate)
   - `restoreReady`: should be false → true (after DB restore)
   - `isRestoring`: should be false → true → false (during restore)

### Test 3: Verify canSave Gate
1. Open browser Console
2. Watch for logs starting with `[audit][saveStrategyData]`
3. **Right after reload** (first 5 seconds):
   - Should see `reason: 'restore_not_ready'` in skipped saves
   - Should see `canSave: false` in the logs
4. **After restore completes** (5-10 seconds):
   - Should see `canSave: true`
   - Saves should succeed

### Test 4: Check Audit Logs
Look for these log patterns in browser console:

```
[audit][saveStrategyData] called {
  reason: '...',
  canSave: true/false,
  hydrated: true/false,
  restoreReady: true/false,
  isRestoring: true/false,
  ...
}

[audit][saveStrategyData] success {
  reason: '...',
  departments_len: 3,
  story_len: 2,
  finalStory_len: 4,
  answers2_len: 2,
  stage1Issues_len: 5,
  winPatterns_len: 2,
  ...
}

[audit][save:start] caller=store:saveStrategyData:... {
  revisionBefore: 12,
  payloadSize: 45678,
  ...
}

[audit][save:done] caller=store:saveStrategyData:... {
  revisionBefore: 12,
  revisionAfter: 13,
  result: 'success',
  ...
}
```

### Test 5: Multiple Reload Cycles
1. Create data
2. Reload (F5)
3. Verify data persists
4. Modify data
5. Reload (F5)
6. Verify modified data persists
7. Repeat 3-4 times

### Test 6: Company Switching
1. Create data in Company A
2. Switch to Company B
3. Verify `isRestoring` becomes true and resets
4. Verify `restoreReady` becomes false
5. Switch back to Company A
6. Verify Company A data is restored correctly

## Key Metrics to Monitor

### In Browser Console
- `[audit][saveStrategyData] called` - All save attempts
- `[audit][saveStrategyData] success` - Successful saves (check payload sizes)
- `[audit][save:start]` - Full save audit trail
- `[audit][save:done]` - Save completion with revision numbers

### In Application State
Execute in console:
```javascript
const s = useStrategyStore.getState();
console.log({
  hydrated: s.hydrated,
  restoreReady: s.restoreReady,
  isRestoring: s.isRestoring,
  canSave: s.hydrated && s.restoreReady && !s.isRestoring,
  dirty: s.dirty,
  revision: s.revision,
  story_len: s.story?.length ?? 0,
  finalStory_len: s.finalStory?.length ?? 0,
  answers2_len: s.answers2?.length ?? 0,
  winPatterns_len: s.winPatterns?.length ?? 0,
});
```

## Expected Log Flow (Timeline)

```
t=0ms    Page loads
t=50ms   [audit][saveStrategyData] called ... hydrated:false restoreReady:false
         → Skipped: restore_not_ready
t=100ms  persist rehydrate completes
         → hydrated=true
t=200ms  refetchFromServer starts
         → isRestoring=true
t=300ms  [audit][save:start] ... during restore
         → Still skipped: restore_not_ready
t=1500ms refetchFromServer completes
         → restoreReady=true, isRestoring=false
t=1600ms [audit][saveStrategyData] called ... hydrated:true restoreReady:true
         → canSave=true, saves proceed
t=1700ms [audit][saveStrategyData] success ... departments_len:3 story_len:2
```

## Troubleshooting

### Data still disappears on reload
1. Check browser console for errors
2. Verify `restoreReady` flag reaches `true` (not stuck in `isRestoring=true`)
3. Check Supabase RLS policies for the user
4. Check if `refetchFromServer` is throwing an error (will see in [audit][save:fail])

### Browser console shows blank for restore flags
1. Ensure you're accessing the correct store: `useStrategyStore.getState()`
2. Refresh page and immediately execute the command
3. Check if there are TypeScript type errors in browser console

### Logs show `reason: 'restore_not_ready'` after 30 seconds
1. Indicates `isRestoring` is never becoming false
2. Check if `refetchFromServer` is hanging
3. Check Supabase network errors in browser DevTools Network tab
4. Look for RLS permission errors in Supabase logs

## Files Modified
- `store/strategyStore.ts`: Added restore flags, canSave gate, audit logs, persist key upgrade

## Related Issues
- TASK 14-1: Restore state flags (hydrated, restoreReady, isRestoring)
- TASK 14-2: DB restore with replace semantics
- TASK 14-3: Persist storage key upgrade (v4 → v5)
- TASK 14-4: canSave gate in saveStrategyData
- TASK 14-5: Auto-save protection (automatic via canSave)
- TASK 14-6: Enhanced audit logging
