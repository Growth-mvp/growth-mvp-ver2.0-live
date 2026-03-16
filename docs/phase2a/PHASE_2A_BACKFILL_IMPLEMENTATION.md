# Phase 2A-3: OKR Backfill Implementation Guide

**Status**: Backfill infrastructure created and ready for execution
**Created**: 2026-03-16
**Target**: Migrate OKRs from `strategy_data.departments[].projects[].okrs[]` to dedicated `okrs` table

## 📋 Overview

This document describes the backfill process for Phase 2A-3, which moves OKR data from the strategy_data JSONB structure to the dedicated okrs table with deterministic ID generation and idempotent execution.

## 🗂️ Files Created

### 1. Core Backfill Implementation
- **`utils/supabase/backfillOkrs.ts`** (client-side utility)
  - Main function: `backfillOkrsFromStrategyData(options)`
  - Deterministic ID generation: `generateDeterministicId(seed)`
  - Supports both dry-run and actual execution
  - Provides detailed skip reports

- **`app/api/debug/backfill-okrs/route.ts`** (server-side API)
  - POST endpoint for executing backfill
  - Query parameter: `{ "dryRun": true/false }`
  - Returns detailed statistics and skip report

### 2. Debug Admin Interface
- **`app/debug/backfill/page.tsx`** (Next.js debug page)
  - Accessible at: `/debug/backfill`
  - Visual interface for running dry-run and actual backfill
  - Real-time result display with statistics
  - Skip report table with detailed information

### 3. Validation Utilities
- **`utils/supabase/backfillValidation.ts`** (client-side validation)
  - Query A: Backfill target count (with id requirements)
  - Query A2: Skip count by reason
  - Query B2: okrsV2-only project count
  - Query C: okrs table verification (post-backfill)
  - Query D: RLS verification
  - Query E: Index verification
  - Query F: Soft delete verification
  - Query G: Deleted OKR count
  - Function: `runAllValidationQueries()` - Execute all at once

## 🚀 How to Run the Backfill

### Step 1: Access the Debug Page

```
http://localhost:3000/debug/backfill
```

### Step 2: Run DRY-RUN

Click the **"Run DRY-RUN"** button. This will:

1. Query all `strategy_data` records
2. Extract OKRs from `departments[].projects[].okrs[]`
3. Validate required fields:
   - `department.id` must exist (no fallback to title)
   - `project.id` must exist (no fallback to title)
   - `okr.objective` must exist
   - `okr.owner` (if present) must be valid UUID
4. Generate deterministic IDs for OKRs without `id`
5. **DO NOT** insert any data (dry-run only)
6. Return detailed statistics

### Step 3: Review DRY-RUN Results

The results page will show:

```
Total Processed: X
Backfilled: Y (these will be inserted)
Skipped:
  - No Department ID: A
  - No Project ID: B
  - No Objective: C
  - Invalid Owner UUID: D
```

**Skip Report Table**: Shows exactly which OKRs are being skipped and why

**OKR Preview**: Shows first 5 OKRs that will be inserted (ID, objective, department, project, owner)

### Step 4: Validate Pre-Backfill State (Optional)

Run validation queries to verify okrs table structure:

```typescript
import { runAllValidationQueries } from '@/utils/supabase/backfillValidation';

const results = await runAllValidationQueries();
// Checks:
// - RLS is enabled on okrs table
// - All indexes are created
// - okrs table is empty (or has expected count)
```

### Step 5: Run ACTUAL BACKFILL

After reviewing dry-run results, click **"Run ACTUAL BACKFILL"** button.

**⚠️ WARNING**: This will actually insert OKRs into the `okrs` table. The operation is idempotent (safe to re-run), but it is still a production data operation.

The system will:

1. Execute the same extraction/validation logic
2. Insert records into `okrs` table via `okrsRepository.upsert()`
3. Use ON CONFLICT strategy to handle duplicates safely
4. Return confirmation with count of inserted/updated records

### Step 6: Verify Post-Backfill State

After backfill completes, run validation queries again:

```typescript
const results = await runAllValidationQueries();
// Checks:
// - okrs_table_count matches expected count
// - strategy_count is correct
// - department_count is correct
// - Soft delete is working
```

Compare results from Step 4 vs Step 6:
- **Before**: `okrs_table_count = 0`
- **After**: `okrs_table_count = [count of backfilled OKRs]`

## 🔧 API Endpoint Reference

### POST /api/debug/backfill-okrs

**Request**:
```json
{
  "dryRun": true
}
```

**Response (Dry-Run)**:
```json
{
  "success": true,
  "dryRun": true,
  "stats": {
    "totalProcessed": 150,
    "backfilled": 145,
    "skipped": {
      "noDepartmentId": 2,
      "noProjectId": 1,
      "noObjective": 2,
      "invalidOwnerUuid": 0
    },
    "errors": []
  },
  "skipReport": [
    {
      "strategyId": "uuid-xxx",
      "departmentId": null,
      "reason": "department.id missing or invalid"
    }
  ],
  "okrsPreview": [ /* first 5 OKRs */ ],
  "totalOkrsPrepared": 145,
  "timestamp": "2026-03-16T10:00:00Z"
}
```

**Response (Actual Backfill)**:
```json
{
  "success": true,
  "dryRun": false,
  "stats": {
    "totalProcessed": 150,
    "backfilled": 145,
    "skipped": { /* same as dry-run */ },
    "errors": []
  },
  "skipReport": [ /* same as dry-run */ ],
  "totalOkrsPrepared": 145,
  "timestamp": "2026-03-16T10:00:00Z"
}
```

## 📊 Deterministic ID Generation

The backfill uses **deterministic UUID generation** to ensure idempotent execution:

```
Seed = ${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}
ID = UUID5(NAMESPACE, seed)  // Same seed always produces same UUID
```

**Example**:
```
Seed: "abc-123:dept-001:proj-001:Build API:0"
ID:   "7b2ffc1c-7a8d-5e6f-8c9d-1a2b3c4d5e6f"  // Deterministic
```

**Benefits**:
- ✅ Safe to re-run backfill (won't create duplicates)
- ✅ ID is stable across executions
- ✅ No risk of gen_random_uuid() collisions

## 🚨 Important Constraints

### 1. Required Fields
- `department.id` - REQUIRED (no fallback to title)
- `project.id` - REQUIRED (no fallback to title)
- `objective` - REQUIRED

**Consequence**: OKRs missing these fields are **SKIPPED** with detailed reporting

### 2. No Production Random IDs
The backfill **MUST NOT** use `gen_random_uuid()` as fallback. This ensures:
- Idempotent execution (re-running produces same results)
- No duplicate handling edge cases
- Deterministic traceability

### 3. Soft Delete Always
When reading OKRs, always filter `is_deleted = false`. This is enforced in:
- `okrsRepository.queryByProjectId()`
- `okrsRepository.queryByStrategyId()`
- `okrsRepository.queryById()`

### 4. okrsV2 No Auto-Migration
OKRs in `okrsV2[]` format are **NOT** automatically migrated in Phase 2A-3:
- They have complex `keyResults` structure
- Requires Phase 2C KR table migration
- Currently only monitored via Query B2

## 📈 Expected Results (Sample)

Based on typical data:

```
Total Processed: 1,245
Backfilled: 1,200 (96.4%)
Skipped:
  - No Department ID: 25
  - No Project ID: 15
  - No Objective: 5
  - Invalid Owner UUID: 0
```

**okrsV2-Only Projects**: 8 projects (to be handled in Phase 2C)

## ✅ Post-Backfill Checklist

- [ ] DRY-RUN completed and reviewed
- [ ] Skip report reviewed and approved
- [ ] Pre-backfill validation queries run
- [ ] ACTUAL BACKFILL executed
- [ ] Post-backfill validation queries run
- [ ] okrs_table_count matches expected count
- [ ] Soft delete working (is_deleted = false filters correctly)
- [ ] Progress_logs.okr_id FK structure verified
- [ ] Ready for STAGE4 cutover (okrService integration)

## 🔄 Rollback Plan

If the backfill needs to be rolled back:

```sql
-- Option 1: Soft delete all backfilled OKRs
UPDATE okrs
SET is_deleted = true,
    updated_at = NOW()
WHERE source_stage = 'migration'
  AND created_at >= '2026-03-16T00:00:00Z';

-- Option 2: Physical delete (if absolutely necessary)
DELETE FROM okrs
WHERE source_stage = 'migration'
  AND created_at >= '2026-03-16T00:00:00Z';

-- Verify rollback
SELECT COUNT(*) FROM okrs WHERE is_deleted = false;
```

## 🎯 Next Steps (After Backfill)

1. **STAGE4 Cutover** (Phase 2A-4)
   - Integrate `okrService.resolveProjectsWithOkrs()` into okr/page.tsx
   - okrs table becomes primary source, snapshot becomes fallback
   - Update okr edit/create forms to use okrsRepository

2. **Progress Logs Integration** (Phase 2A-5)
   - Populate `progress_logs.okr_id` via okrs.id references
   - Create progress tracking tied to individual OKRs

3. **STAGE3 Migration** (Phase 2A-6)
   - Use unified `resolveProjectsWithOkrs()` across STAGE3/4
   - Sync canonical OKRs to snapshot (readonly)

## 📞 Support & Debugging

### Enable Debug Logging

```typescript
// In browser console
localStorage.setItem('DEBUG_BACKFILL', '1');
```

### Check Backfill API Logs

```bash
# View server logs
tail -f .next/logs/api-debug-backfill-okrs.log
```

### Manual Query Execution

```typescript
import { queryA, queryA2, queryB2, queryC } from '@/utils/supabase/backfillValidation';

const results = {
  backfillTarget: await queryA(),
  skipCount: await queryA2(),
  okrsV2Only: await queryB2(),
  okrsTableCount: await queryC(),
};

console.log(results);
```

## 📝 Audit Trail

All backfilled OKRs include:
- `source_stage = 'migration'`
- `source_okr_id` - reference to original okr.id
- `created_at` - timestamp from strategy_data.updated_at
- `created_by` - user who triggered backfill
- `meta_json` - additional metadata if needed

This allows tracing data lineage and rolling back if necessary.

---

**Last Updated**: 2026-03-16
**Backfill Status**: Ready for dry-run execution
**Next Milestone**: Post-backfill STAGE4 integration
