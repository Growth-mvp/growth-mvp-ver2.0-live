# Phase 2A-3: Backfill Quick Reference Card

## 🎯 What to Do Right Now

1. **Test Dry-Run**
   ```
   Visit: http://localhost:3000/debug/backfill
   Click: "Run DRY-RUN"
   Review: Statistics and skip report
   ```

2. **If results look good, run actual backfill**
   ```
   Click: "Run ACTUAL BACKFILL"
   Confirm: Warning dialog
   Wait: 1-5 minutes
   ```

3. **Verify results**
   ```
   Check: okrs_table_count ≈ 1,200
   Check: Post-backfill validation queries
   Check: Soft delete working (is_deleted = false)
   ```

---

## 📁 Files Created (5 Total)

### Core Implementation
| File | Purpose | Status |
|------|---------|--------|
| `utils/supabase/backfillOkrs.ts` | Main backfill logic + deterministic ID gen | ✅ Ready |
| `app/api/debug/backfill-okrs/route.ts` | API endpoint (POST) | ✅ Ready |
| `utils/supabase/backfillValidation.ts` | 7 validation queries | ✅ Ready |

### User Interfaces
| File | Purpose | Access |
|------|---------|--------|
| `app/debug/backfill/page.tsx` | GUI for dry-run/backfill | `/debug/backfill` |

### Documentation
| File | Purpose | Length |
|------|---------|--------|
| `PHASE_2A_BACKFILL_IMPLEMENTATION.md` | Complete how-to guide | 400+ lines |
| `PHASE_2A_STAGE4_CUTOVER.md` | STAGE4 integration plan | 350+ lines |
| `PHASE_2A_IMPLEMENTATION_SUMMARY.md` | Executive summary | 300+ lines |

---

## 🚀 Three Ways to Run Backfill

### Method 1: GUI (Easiest)
```
1. Go to: http://localhost:3000/debug/backfill
2. Click: "Run DRY-RUN"
3. Review results
4. Click: "Run ACTUAL BACKFILL" (if satisfied)
```

### Method 2: API (Automation)
```bash
# Dry-run
curl -X POST http://localhost:3000/api/debug/backfill-okrs \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Actual
curl -X POST http://localhost:3000/api/debug/backfill-okrs \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

### Method 3: Code
```typescript
import { backfillOkrsFromStrategyData } from '@/utils/supabase/backfillOkrs';

const result = await backfillOkrsFromStrategyData({ dryRun: true });
console.log(result.stats);
```

---

## 📊 Expected Results

```
Backfill Target: ~1,250 OKRs
✅ Backfilled: ~1,200 (96%)
⏭️ Skipped: ~50 (missing ids)
  • No dept ID: ~25
  • No proj ID: ~15
  • No objective: ~5
  • Invalid owner: ~0

okrsV2-only projects (not migrated): ~8
  → Will handle in Phase 2C
```

---

## ✅ Post-Backfill Checklist

- [ ] DRY-RUN completed
- [ ] Skip report reviewed
- [ ] ACTUAL BACKFILL completed
- [ ] okrs_table_count = expected (≈1,200)
- [ ] RLS enabled (Query D)
- [ ] Indexes created (Query E)
- [ ] Soft delete working (Query F)
- [ ] Ready for STAGE4 cutover

---

## 🔑 Key Technical Points

### Deterministic ID Generation
```
Seed: ${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}
ID: generateDeterministicId(seed)  // Same seed = same UUID
```
✅ **NO gen_random_uuid() fallback** (production requirement)

### Field Validation
```
✅ Required: department.id, project.id, objective
❌ No fallback to title (strict validation)
⚠️ owner_user_id must be valid UUID (skipped if not)
```

### Soft Delete Behavior
```
All reads filter: is_deleted = false
Deletion: UPDATE okrs SET is_deleted = true
Rollback: Update is_deleted = true back to false
```

---

## 🔗 Documentation Map

| Need | File | Lines |
|------|------|-------|
| How to run backfill | PHASE_2A_BACKFILL_IMPLEMENTATION.md | 50-150 |
| Detailed specs | PHASE_2A_BACKFILL_CONFIRMATION.md | See table mapping |
| STAGE4 cutover | PHASE_2A_STAGE4_CUTOVER.md | 100-250 |
| Executive summary | PHASE_2A_IMPLEMENTATION_SUMMARY.md | Quick links |
| SQL schema | PHASE_2A_SUPABASE_MIGRATION.sql | STEP 1-6 |

---

## ⚠️ Critical Constraints

1. **No gen_random_uuid() in production**
   - Use deterministic ID generation instead
   - Ensures idempotent execution

2. **Mandatory field validation**
   - department.id required (skip if missing)
   - project.id required (skip if missing)
   - objective required (skip if missing)

3. **Soft delete always**
   - is_deleted = false required for all reads
   - Prevents deleted OKRs from reappearing

4. **okrsV2 not auto-migrated**
   - okrsV2[] projects skipped (needs KR table)
   - Monitored via Query B2
   - Phase 2C handles migration

---

## 🆘 If Something Goes Wrong

### Backfill stuck?
```sql
-- Check if okrs table exists
SELECT * FROM information_schema.tables WHERE table_name = 'okrs';

-- Check RLS
SELECT * FROM pg_policies WHERE tablename = 'okrs';

-- Check recent OKR inserts
SELECT COUNT(*) FROM okrs WHERE created_at > NOW() - INTERVAL '10 minutes';
```

### High skip count?
- Check if department.id exists in strategy_data
- Check if project.id exists in strategy_data
- Review skip report for patterns

### Can't access `/debug/backfill`?
- Verify running on localhost:3000
- Check Next.js build successful
- Clear browser cache

### Need to rollback?
```typescript
// Easy: Just set is_deleted = true for all migrated OKRs
await supabase
  .from('okrs')
  .update({ is_deleted: true })
  .eq('source_stage', 'migration');
```

---

## 📝 Audit Trail

Each backfilled OKR records:
- `source_stage = 'migration'` (identifies backfilled records)
- `source_okr_id` (original okr.id for traceability)
- `created_at` (timestamp from strategy_data)
- `created_by` (user who triggered backfill)

Allows full traceability and rollback if needed.

---

## 🎯 Success Criteria

✅ **Backfill successful when**:
- DRY-RUN shows ~1,200 OKRs to migrate
- ACTUAL BACKFILL completes without errors
- Post-backfill queries show okrs_table_count ≈ 1,200
- Skip count matches expected patterns
- RLS is enabled and working
- Soft delete filtering works correctly

---

## 📅 Timeline

| Stage | Duration | Status |
|-------|----------|--------|
| DRY-RUN | 1-2 min | Now |
| ACTUAL BACKFILL | 1-5 min | After review |
| Post-validation | 1-2 min | After backfill |
| STAGE4 prep | — | After validation ✓ |

**Total: ~10-15 minutes**

---

## 🎬 Next: STAGE4 Cutover

After backfill succeeds:

1. **Modify okr/page.tsx**
   - Use `resolveProjectsWithOkrs()` instead of snapshot
   - Write changes to okrs table instead of snapshot

2. **Add feature flag**
   - `USE_OKR_TABLE_PRIMARY` (gradual rollout)

3. **Monitor metrics**
   - Error rates
   - Data consistency
   - User experience

**See**: `PHASE_2A_STAGE4_CUTOVER.md` for full plan

---

## 💡 Pro Tips

1. **Save dry-run results** for comparison with actual
2. **Review skip report** before running actual backfill
3. **Run validation queries** before and after
4. **Keep audit trail** of when backfill was executed
5. **Test STAGE4 locally** with feature flag before deploy

---

**Created**: 2026-03-16
**Status**: Ready for execution
**Deterministic ID**: ✅ Implemented (no gen_random_uuid fallback)
