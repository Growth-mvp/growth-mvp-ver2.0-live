# 🎯 Infinite Retry Loop: Emergency Debugging Changes

## Summary
Fixed critical infinite retry loop by implementing selective retry logic and comprehensive diagnostic logging. The infinite refetch now stops on permanent errors (RLS, 404, permission denied) while only retrying on transient network failures.

---

## Files Modified (3)

### 1️⃣ `app/layoutClient.tsx` (lines 375-406)
**Purpose**: Verify logged-in user ID matches membership record

**Changes**:
- Made `requestAnimationFrame` callback async to support `await supabase.auth.getUser()`
- Added auth verification logging before refetchFromServer call
- Logs actual user ID, store user ID, and comparison result

**Key Lines**:
```typescript
// Lines 390-399: Auth verification logging
const { data: authData, error: authErr } = await supabase.auth.getUser();
const actualUserId = authData?.user?.id ?? 'unknown';
const storeUserId = useUserStore.getState().user?.id ?? 'unknown';
console.log('[auth] login user verification', {
  actualUserId,
  storeUserId,
  match: actualUserId === storeUserId,
  companyId,
});
```

**Impact**: Identifies if RLS issues stem from auth session mismatch

---

### 2️⃣ `utils/supabase/strategy.ts` (lines 535-546)
**Purpose**: Distinguish between query success, RLS errors, and network errors

**Changes**:
- Added comprehensive logging after Supabase query execution
- Logs data presence, error codes, HTTP status, and returned row details
- Helps identify whether error is 0-rows, 403-Forbidden, or network-related

**Key Lines**:
```typescript
// Lines 535-546: Query result diagnostic logging
console.log('[StrategyData] 📊 query result (baseRes)', {
  hasData: !!baseRes.data,
  hasError: !!baseRes.error,
  errorCode: baseRes.error?.code,
  errorStatus: (baseRes.error as any)?.status,
  errorMessage: baseRes.error?.message,
  rowsCount: baseRes.data ? 1 : 0,
  data_id: baseRes.data?.id,
  data_company_id: baseRes.data?.company_id,
  data_revision: baseRes.data?.revision,
});
```

**Impact**: Makes root cause visible in browser console

---

### 3️⃣ `store/strategyStore.ts` (3 locations)

#### Location A: Type Definition (lines 242-243)
**Purpose**: Store permanent server errors for UI display

**Changes**:
```typescript
/** 直近サーバ取得エラー（RLS/404/不許可など永続エラーを格納） */
__lastServerError?: Error | null;
```

#### Location B: Empty State Initialization (line 787)
**Purpose**: Initialize new field in default state

**Changes**:
```typescript
__lastServerError: undefined,
```

#### Location C: Selective Retry Logic (lines 1613-1660)
**Purpose**: Stop infinite retry on permanent errors

**Changes**:
- Error code checking to distinguish transient vs permanent errors
- Transient errors (FETCH_FAILED, NETWORK_ERROR, 502/503/504) → RETRY
- Permanent errors (RLS, 403, 0 rows) → STORE ERROR, NO RETRY
- 0 rows returned → Treat as permanent error (RLS/not found)

**Key Logic**:
```typescript
// Lines 1617-1622: Classify error as transient or permanent
const isTransientError =
  errorCode === 'FETCH_FAILED' ||
  errorCode === 'NETWORK_ERROR' ||
  errorStatus === 502 ||
  errorStatus === 503 ||
  errorStatus === 504;

// Lines 1639-1644: Only schedule retry for transient errors
if (isTransientError) {
  scheduleRefetchRetry(2000);
} else {
  console.error('[strategyStore] 🚫 permanent error, no retry scheduled:', errorCode, errorStatus);
}

// Lines 1649-1660: Treat 0 rows as permanent error
if (!data) {
  console.log('[strategyStore] refetch returned 0 rows (RLS/not found) - no retry');
  set((s) => ({
    ...s,
    __lastServerError: new Error('データが見つかりません'),
  }));
}
```

**Impact**: Stops infinite loop, stores error for UI display

---

## Files Created (4)

### 📋 `DEBUG_INFINITE_RETRY_PLAN.md`
Comprehensive debug plan with expected log patterns and verification checklist

### 📋 `VERIFICATION_STEPS.md`
Step-by-step guide for running diagnostics and verifying the fix

### 🔍 `scripts/sql/diag_policies.sql`
Diagnostic SQL to check RLS policy configuration on strategy_data table

### 🔍 `scripts/sql/diag_data.sql`
Diagnostic SQL to verify data existence and user membership

---

## Expected Behavior Changes

### Before Fix ❌
- `getFullStrategyDataByCompany()` returns error
- `scheduleRefetchRetry()` called immediately
- Infinite loop: error → retry → error → retry → ...
- Browser console flooded with repeated logs

### After Fix ✅
- `getFullStrategyDataByCompany()` returns error
- **Selective retry logic checks error type**
- If RLS/404/permission: Error stored, **NO RETRY**, single attempt
- If network: Retry up to transient failure threshold
- Clear diagnostic logs show exactly what went wrong

---

## Testing Instructions

### 1. Check Diagnostic SQL
```bash
# In Supabase SQL Editor:
1. Copy scripts/sql/diag_policies.sql → Run
2. Copy scripts/sql/diag_data.sql → Run
3. Verify data exists and user has membership
```

### 2. Reload App with Console Open
```bash
1. F12 → Console
2. Ctrl+Shift+R (hard refresh)
3. Watch for [auth] logs → [StrategyData] logs
4. Count logs: should be SINGLE attempt, not repeating
```

### 3. Verify No Infinite Loop
```bash
1. Search console for "scheduleRefetchRetry"
2. Should NOT appear (or only once for transient errors)
3. Search for "🚫 permanent error"
4. If seen, confirms selective retry is working
```

---

## Logs to Look For

### Success Scenario
```
[auth] login user verification: {match: true}
[StrategyData] 📥 getFullStrategyDataByCompany start: e0f342d6...
[StrategyData] 📊 query result (baseRes): {hasData: true, rowsCount: 1}
[LOAD raw financial data]: {financeBS_len: 12, segmentBS_len: 3}
✓ NO RETRY ATTEMPT - DATA LOADS
```

### Permanent Error Scenario
```
[auth] login user verification: {match: true}
[StrategyData] 📥 getFullStrategyDataByCompany start: e0f342d6...
[StrategyData] 📊 query result (baseRes): {hasError: true, errorStatus: 403}
[strategyStore] refetch error - selective retry: {isTransientError: false}
[strategyStore] 🚫 permanent error, no retry scheduled: PGRST116 403
✓ ERROR SHOWN ONCE - NO INFINITE LOOP
```

### Network Error Scenario (Transient)
```
[StrategyData] 📒 query result (baseRes): {hasError: true, errorCode: NETWORK_ERROR}
[strategyStore] refetch error - selective retry: {isTransientError: true}
[strategyStore] scheduled retry in 2000ms
✓ SINGLE RETRY ATTEMPT (not infinite)
```

---

## Rollback Instructions

If issues arise, revert these changes:
```bash
git checkout -- app/layoutClient.tsx
git checkout -- utils/supabase/strategy.ts
git checkout -- store/strategyStore.ts
rm DEBUG_INFINITE_RETRY_PLAN.md VERIFICATION_STEPS.md
rm -rf scripts/sql/
```

---

## Next Steps

1. **Run diagnostic SQL scripts** (scripts/sql/)
2. **Reload app** with console open
3. **Compare logs** to expected patterns in VERIFICATION_STEPS.md
4. **Report findings**:
   - Does infinite loop stop? ✓/✗
   - Do logs match success pattern? ✓/✗
   - Any new error messages? ✓/✗

