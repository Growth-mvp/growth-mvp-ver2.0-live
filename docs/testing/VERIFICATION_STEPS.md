# Step-by-Step Verification Guide

## Quick Reference: What Changed

✅ **4 code files modified** to stop infinite retry loop:
1. `app/layoutClient.tsx` - Added auth user ID verification
2. `utils/supabase/strategy.ts` - Added comprehensive query logging
3. `store/strategyStore.ts` - Added selective retry logic (2 locations)

✅ **2 diagnostic SQL scripts created**:
- `scripts/sql/diag_policies.sql`
- `scripts/sql/diag_data.sql`

---

## Verification Steps

### Step 1: Run Diagnostic SQL (5 minutes)
1. Open Supabase dashboard
2. Go to SQL Editor
3. Create new query → Copy `scripts/sql/diag_policies.sql` → Run
4. Look for: `strategy_data` table with `rowsecurity = true`
5. Create another query → Copy `scripts/sql/diag_data.sql` → Run
6. Look for: At least 1 row in both queries 1 & 2 results

**Expected Results**:
```
Query 1: strategy_data for company e0f342d6-f172-434b-bf9e-9195444bf3b8 EXISTS
Query 2: company_members for user 9bb99a79-5259-42e1-8f59-f54acdce97c0 EXISTS
```

---

### Step 2: Test in Browser (5 minutes)

1. **Open Developer Console**
   - Press `F12` → Console tab

2. **Reload Application**
   - `Ctrl + Shift + R` (hard refresh)

3. **Watch Logs Appear**
   - Filter: `[auth]` → Look for:
     ```
     [auth] login user verification {
       actualUserId: "9bb99a79-5259-42e1-8f59-f54acdce97c0",
       storeUserId: "9bb99a79-5259-42e1-8f59-f54acdce97c0",
       match: true
     }
     ```

4. **Watch Refetch Logs**
   - Filter: `StrategyData` → Look for:
     ```
     [StrategyData] 📊 query result (baseRes) {
       hasData: true,  ← THIS IS KEY
       rowsCount: 1,
       data_company_id: "e0f342d6-f172-434b-bf9e-9195444bf3b8"
     }
     ```

5. **Check for Infinite Retry**
   - Search: `scheduleRefetchRetry`
   - **SHOULD NOT APPEAR** - if it does, selective retry logic didn't work

6. **Watch for Error Messages**
   - If you see: `🚫 permanent error, no retry scheduled`
   - This means an error was detected as non-retryable (expected for RLS issues)

---

## Expected Outcomes

### ✅ Success (Data Loads)
Console shows:
```
[auth] login user verification: {match: true}
[StrategyData] 📊 query result (baseRes): {hasData: true, rowsCount: 1}
[LOAD raw financial data]: {...}
[strategyStore refetch] normalized patch: {...}
✓ App loads normally
```

### ✅ Permanent Error (No Infinite Loop)
Console shows:
```
[auth] login user verification: {match: true}
[StrategyData] 📊 query result (baseRes): {hasData: false, errorStatus: 403}
[strategyStore] refetch error - selective retry: {isTransientError: false}
[strategyStore] 🚫 permanent error, no retry scheduled: PGRST116 403
✓ Error is shown ONCE, no continuous retries
```

### ❌ Infinite Loop (Issue Not Fixed)
Console shows (repeating):
```
[StrategyData] 📥 getFullStrategyDataByCompany start...
[StrategyData] 📊 query result (baseRes)...
scheduleRefetchRetry...
[StrategyData] 📥 getFullStrategyDataByCompany start...  ← REPEATS
```

**If this happens**: Open browser DevTools Network tab → Check for repeated `/strategy_data` queries

---

## Troubleshooting

### If seeing "404 Not Found" errors
→ SQL diagnostic 1 result: 0 rows
→ Check: Does strategy_data exist for this company_id?
→ Fix: Create missing test data

### If seeing "403 Forbidden" errors
→ SQL diagnostic 2 result: company_members shows different user_id
→ Check: Is logged-in user in company_members?
→ Fix: Add user to company_members as admin role

### If match=false in auth verification
→ Two different user IDs in logs
→ Check: Did you log out/switch accounts?
→ Fix: Clear browser storage, log in again

### If no logs appearing at all
→ Check: Is console filter empty? (or filtered to hide logs)
→ Try: Search for `[` to see all bracketed logs

---

## Files to Check/Commit

After verification, review these changed files:

```bash
git diff app/layoutClient.tsx
git diff utils/supabase/strategy.ts
git diff store/strategyStore.ts
```

All changes should be:
- ✅ Logging additions (no logic change)
- ✅ Error handling improvements (selective retry)
- ✅ Type definition additions (__lastServerError field)

**Safe to commit** if tests pass.

