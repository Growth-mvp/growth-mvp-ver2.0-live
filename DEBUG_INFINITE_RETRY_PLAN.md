# 🚀 Debug Plan: Infinite Retry Loop Fix

## Problem Statement
`getFullStrategyDataByCompany()` returns "データが見つかりません" error immediately, triggering an infinite retry loop via `scheduleRefetchRetry()`.

**Critical Discovery**: DB verification shows the data EXISTS:
- `strategy_data` row with company_id = e0f342d6-f172-434b-bf9e-9195444bf3b8 (revision=0) ✓
- `company_members` row with matching company_id and user_id=9bb99a79-5259-42e1-8f59-f54acdce97c0, role=admin ✓

**Root Cause Hypotheses**:
1. RLS policy hiding data (403 Forbidden)
2. Query condition mismatch (e.g., filtering by wrong user_id)
3. Auth session user_id differs from membership user_id

---

## Changes Implemented

### ✅ Step B: Auth User ID Verification
**File**: `app/layoutClient.tsx` (lines 375-406)

Added auth.getUser().id logging to verify actual login user matches membership:
```typescript
const { data: authData } = await supabase.auth.getUser();
const actualUserId = authData?.user?.id ?? 'unknown';
const storeUserId = useUserStore.getState().user?.id ?? 'unknown';
console.log('[auth] login user verification', {
  actualUserId,
  storeUserId,
  match: actualUserId === storeUserId,
  companyId,
});
```

**Expected Log Output**:
```
[auth] login user verification: {
  actualUserId: 9bb99a79-5259-42e1-8f59-f54acdce97c0,
  storeUserId: 9bb99a79-5259-42e1-8f59-f54acdce97c0,
  match: true,
  companyId: e0f342d6-f172-434b-bf9e-9195444bf3b8
}
```

---

### ✅ Step C: Comprehensive Query Result Logging
**File**: `utils/supabase/strategy.ts` (lines 535-546)

Added detailed Supabase query result logging to distinguish:
- **0 rows**: RLS/not found (permanent error)
- **403 Forbidden**: Permission denied (permanent error)
- **502/503/504**: Network errors (transient, retry)

```typescript
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

**Expected Log Patterns**:

✓ Success:
```
[StrategyData] 📊 query result (baseRes): {
  hasData: true,
  hasError: false,
  errorCode: null,
  errorStatus: null,
  errorMessage: null,
  rowsCount: 1,
  data_id: "...",
  data_company_id: "e0f342d6-f172-434b-bf9e-9195444bf3b8",
  data_revision: 0
}
```

✗ RLS Issue (0 rows):
```
[StrategyData] 📊 query result (baseRes): {
  hasData: false,
  hasError: false,
  errorCode: null,
  errorStatus: null,
  rowsCount: 0
}
[strategyStore] refetch returned 0 rows (RLS/not found) - no retry
```

✗ Permission Error (403):
```
[StrategyData] 📊 query result (baseRes): {
  hasData: false,
  hasError: true,
  errorCode: "PGRST116",
  errorStatus: 403,
  errorMessage: "403"
}
[strategyStore] refetch error - selective retry: {
  errorCode: "PGRST116",
  errorStatus: 403,
  isTransientError: false
}
[strategyStore] 🚫 permanent error, no retry scheduled: PGRST116 403
```

---

### ✅ Step D: Selective Retry Logic
**File**: `store/strategyStore.ts` (lines 1610-1660)

Implemented conditional retry that only retries on transient network errors:

**Transient Errors** (RETRY):
- FETCH_FAILED
- NETWORK_ERROR
- HTTP 502/503/504

**Permanent Errors** (NO RETRY - stored in __lastServerError):
- RLS violations (403 Forbidden)
- 0 rows returned
- Query errors

**New Field** added to `StrategyState`:
```typescript
/** 直近サーバ取得エラー（RLS/404/不許可など永続エラーを格納） */
__lastServerError?: Error | null;
```

**Logic Flow**:
1. Query returns error → Check error code/status
2. If transient → Call scheduleRefetchRetry(2000)
3. If permanent → Store in __lastServerError, set __isFetchingFromServer=false, **NO RETRY**
4. Query returns 0 rows → Mark as permanent error, **NO RETRY**

---

### ✅ Step E: Diagnostic SQL Scripts

#### `scripts/sql/diag_policies.sql`
Check RLS policy configuration:
```sql
-- View RLS status and policies on strategy_data table
SELECT policyname, tablename, permissive, roles, qual FROM pg_policies
WHERE tablename = 'strategy_data';
```

**Execute in**: Supabase SQL Editor

#### `scripts/sql/diag_data.sql`
Verify data and membership:
```sql
-- Check strategy_data for test company
SELECT company_id, revision FROM strategy_data
WHERE company_id = 'e0f342d6-f172-434b-bf9e-9195444bf3b8';

-- Check user membership
SELECT user_id, company_id, role FROM company_members
WHERE company_id = 'e0f342d6-f172-434b-bf9e-9195444bf3b8';
```

**Execute in**: Supabase SQL Editor

---

## Step F: Verification Checklist

### 🔍 Before Opening App
- [ ] Run diagnostic SQL scripts in Supabase SQL Editor
  - [ ] `diag_policies.sql` → Note RLS policy for strategy_data
  - [ ] `diag_data.sql` → Confirm test data exists and membership matches

### 🌐 After Opening App (Developer Console)
- [ ] F12 → Console tab → Reload page
- [ ] Look for these logs in order:
  1. `[auth] login user verification` → ✓ IDs match?
  2. `[StrategyData] 📥 getFullStrategyDataByCompany start`
  3. `[StrategyData] 📊 query result (baseRes)` → ✓ hasData=true or hasError=true?
  4. If hasData=true → `[LOAD raw financial data]` → Load succeeds ✓
  5. If hasError=true → Check errorCode/errorStatus

### ✓ Success Case
- Single attempt at refetch
- No `scheduleRefetchRetry` call
- `[strategyStore] 🚫 permanent error, no retry scheduled` logged
- App shows error UI or graceful fallback

### ✗ Failure Case (Requires Investigation)
- Logs still showing repeated refetch attempts
- `scheduleRefetchRetry` appearing in console repeatedly
- Check which error code/status is present

---

## Logs to Expect

### Layout/Auth Logs
```
[layout] store marker set
[auth] login user verification {actualUserId, storeUserId, match, companyId}
```

### Refetch Attempt 1
```
[StrategyData] 📥 getFullStrategyDataByCompany start: e0f342d6-f172-434b-bf9e-9195444bf3b8
[StrategyData] 📊 query result (baseRes) {hasData, hasError, errorCode, ...}
[strategyStore] refetch error - selective retry {errorCode, errorStatus, isTransientError, message}
[strategyStore] 🚫 permanent error, no retry scheduled: ...
```

### No Retry Scheduled ✓
After these logs, no additional refetch attempts should occur. The error should be stored in store and presented to user UI.

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `app/layoutClient.tsx` | Add auth.getUser() logging | 375-406 |
| `utils/supabase/strategy.ts` | Add query result logging | 535-546 |
| `store/strategyStore.ts` | Selective retry logic | 1610-1660 |
| `store/strategyStore.ts` | Add __lastServerError field | 242-243, 787 |
| `scripts/sql/diag_policies.sql` | NEW - RLS diagnostics | all |
| `scripts/sql/diag_data.sql` | NEW - Data diagnostics | all |

---

## Next Steps if Still Failing

### If logs show RLS error (403)
→ Check `diag_policies.sql` output
→ Verify user is included in policy `roles`
→ Check `company_members` table for matching user_id

### If logs show 0 rows with no error
→ Run `diag_data.sql` query 1 & 2
→ Verify strategy_data row exists
→ Verify company_members row exists with test user_id

### If actualUserId ≠ storeUserId
→ Auth session mismatch
→ Check userStore initialization in layoutClient
→ Verify Supabase client session is loaded

