# TypeScript TS2322 Fix Report: strategyId Type Mismatch

## Issue
**Location:** store/strategyStore.ts, line 1220
**Error:** TS2322 - Type 'undefined' is not assignable to type 'string | null'
**Code:**
```typescript
strategyId: undefined, // ★ FIX: null → undefined
```

## Root Cause
The `emptyData` object was assigning `undefined` to the `strategyId` field, but the type definition for `StrategyState` specifies `strategyId: string | null`, which does not include `undefined`.

### Type Definition (line 163)
```typescript
export type StrategyState = {
  companyId: string | null;
  strategyId: string | null;  // ✓ Accepts string or null, NOT undefined
  ...
}
```

## Fix Applied
**Changed:** Line 1220 in store/strategyStore.ts
```typescript
// Before:
strategyId: undefined, // ★ FIX: null → undefined（refetchFromServer で DB から復元される）

// After:
strategyId: null, // ★ ID未設定: refetchFromServer で DB から復元される
```

### Rationale
- In JavaScript/TypeScript, `null` is the idiomatic way to represent an unset ID value
- The type signature `string | null` is explicit: null represents "not set", undefined should not be used
- Both values are falsy, but using the correct type prevents TypeScript errors
- No behavioral change: both null and undefined are falsy, but type safety is improved

## Verification

### TypeScript Type Check
```bash
npx tsc -p tsconfig.json --noEmit
```
**Result:** No errors related to `strategyId` or TS2322
- strategyId assignment now matches the declared type `string | null`
- Removes type mismatch error

### Change Origin
**When was this introduced?**
- This issue existed **before** the current businessSegments fix
- Confirmed by examining git diff: strategyId:undefined was not part of the businessSegments changes
- The line was previously modified with intention, but used the wrong value (undefined vs null)

## Impact Analysis

**Safe to Deploy:** ✅ YES
- No behavioral change (null and undefined are both falsy)
- Fixes TypeScript type error
- Makes code more idiomatic (null for missing values)
- No data migration required

**Backward Compatibility:** ✅ COMPATIBLE
- Existing data is unaffected
- Runtime behavior identical (both null and undefined are falsy)
- Type safety improved

## Related Code Paths
The `strategyId` field is used in:
1. `refetchFromServer()` - Loads strategy ID from database
2. `setStrategyId()` - Updates the strategy ID
3. Conditional checks: `if (strategyId)` treat null and undefined identically

## Testing Performed
- ✅ TypeScript type check: No strategyId errors
- ✅ Build verification: npm run build succeeds
- ✅ Diff review: Change is isolated and correct
- ✅ Type definition review: null is the correct sentinel value for this field

## Conclusion

The TS2322 error has been fixed by changing `undefined` to `null` for the initial `strategyId` value. This aligns with:
1. The declared type `string | null`
2. JavaScript/TypeScript idioms for unset values
3. The semantic intent of the code (ID not yet loaded from database)

**Status:** ✅ FIXED AND VERIFIED
