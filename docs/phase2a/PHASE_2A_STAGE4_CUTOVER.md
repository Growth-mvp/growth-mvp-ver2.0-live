# Phase 2A-4: STAGE4 Cutover Plan

**Status**: Prepared (awaiting post-backfill execution)
**Target Milestone**: Move okrs table to primary source, snapshot to fallback
**Affected Files**:
- `pages/okr/page.tsx` (main OKR display/edit)
- `services/okrService.ts` (already prepared)
- `utils/supabase/okrsRepository.ts` (already prepared)
- Related STAGE4 pages

## 📋 Overview

STAGE4 Cutover switches OKR data sourcing from snapshot-primary to database-primary:

```
BEFORE (Phase 2A-3):
strategy_data.snapshot.okrs[] ← primary source
    ↓ fallback if missing
okrs table ← populated (via backfill)

AFTER (Phase 2A-4):
okrs table ← primary source (DB-first reads)
    ↓ fallback if missing
strategy_data.snapshot.okrs[] ← fallback for legacy data
```

## 🔧 Implementation Changes Required

### 1. okr/page.tsx - Main OKR Display

**Current Flow**:
```typescript
// BEFORE
const strategy = await queryStrategy(strategyId);
const projects = strategy.departments[0].projects;
// Uses: project.okrs from snapshot
```

**New Flow**:
```typescript
// AFTER
import { resolveProjectsWithOkrs } from '@/services/okrService';

const strategy = await queryStrategy(strategyId);
const department = strategy.departments[0];
const projectsWithOkrs = await resolveProjectsWithOkrs(
  strategy.id,
  department.id,
  strategy.company_id
);
// Uses: okrs table as primary source, snapshot as fallback
```

**Key Change**:
- Replace direct snapshot access with `resolveProjectsWithOkrs()`
- Function automatically merges DB and snapshot sources
- Returns `ResolvedOkr[]` with source tracking

### 2. OKR Create/Edit Forms

**Current**: Saves directly to `strategy_data.snapshot.okrs[]`

**New**:
1. Save to `okrs` table via `okrsRepository.upsert()`
2. Calculate new snapshot shape via `okrService.calculateSnapshotShapeForProject()`
3. Update `strategy_data.snapshot` atomically

```typescript
// Example: Creating new OKR
const input: OkrWriteInput = {
  strategy_id: strategyId,
  department_id: departmentId,
  project_id: projectId,
  objective: newObjective,
  key_results_json: keyResults,
  status: 'draft',
};

// Save to DB
const saved = await okrsRepository.upsert(input, companyId);

// Recalculate snapshot
const newSnapshot = await okrService.calculateSnapshotShapeForProject(
  projectId,
  companyId
);

// Update strategy_data
await updateStrategySnapshot(strategyId, { okrs: newSnapshot });
```

### 3. OKR Reordering

**Current**: Modifies `strategy_data.snapshot.okrs[].sort_order` directly

**New**:
1. Update `okrs.sort_order` via `okrsRepository.batchUpdateSortOrder()`
2. Recalculate snapshot shape
3. Update `strategy_data.snapshot`

```typescript
// Reorder OKRs
const reorders = [
  { id: 'okr-1', sort_order: 0 },
  { id: 'okr-2', sort_order: 1 },
  { id: 'okr-3', sort_order: 2 },
];

await okrsRepository.batchUpdateSortOrder(reorders, companyId);

// Recalculate snapshot
const newSnapshot = await okrService.calculateSnapshotShapeForProject(
  projectId,
  companyId
);

// Update strategy_data
await updateStrategySnapshot(strategyId, { okrs: newSnapshot });
```

### 4. OKR Deletion

**Current**: Sets `okr.is_deleted = true` in snapshot

**New**:
1. Soft delete via `okrsRepository.softDelete()`
2. Recalculate snapshot (automatically filters is_deleted = true)
3. Update `strategy_data.snapshot`

```typescript
// Delete OKR
await okrsRepository.softDelete(okrId, companyId);

// Recalculate snapshot
const newSnapshot = await okrService.calculateSnapshotShapeForProject(
  projectId,
  companyId
);

// Update strategy_data
await updateStrategySnapshot(strategyId, { okrs: newSnapshot });
```

## 📊 Modified Code Sections

### okr/page.tsx Changes

**Location**: Lines where OKR data is read/displayed

```diff
- import { queryStrategy } from '@/utils/supabase/strategy';
+ import { queryStrategy } from '@/utils/supabase/strategy';
+ import { resolveProjectsWithOkrs } from '@/services/okrService';

  export default function OkrPage() {
    // ... existing code ...

    const [strategy, setStrategy] = useState<StrategyData | null>(null);
    const [projectsWithOkrs, setProjectsWithOkrs] = useState<ProjectWithResolvedOkrs[] | null>(null);

    useEffect(() => {
      const loadData = async () => {
        const strategy = await queryStrategy(strategyId);
        setStrategy(strategy);

        // NEW: Load OKRs from okrs table
        const projects = await resolveProjectsWithOkrs(
          strategy.id,
          departmentId,
          strategy.company_id
        );
        setProjectsWithOkrs(projects);
      };

      loadData();
    }, [strategyId, departmentId]);

    // Use projectsWithOkrs instead of strategy.departments[...].projects
    return (
      <div>
        {projectsWithOkrs?.map(project => (
          <ProjectCard
            key={project.id}
            project={project}
            okrs={project.resolvedOkrs}  // NEW: Use resolvedOkrs
          />
        ))}
      </div>
    );
  }
```

### OKR Save Operation

**Location**: OKR edit form submit handler

```diff
  const handleSaveOkr = async (objective: string, keyResults: string[]) => {
    try {
      // Get company_id from auth
      const company = await getCompany();

      // NEW: Save to okrs table
      const input: OkrWriteInput = {
        id: okrId,  // undefined for new OKRs (will be generated)
        strategy_id: strategyId,
        department_id: departmentId,
        project_id: projectId,
        objective,
        key_results_json: keyResults,
        status: 'draft',
        sort_order: 0,
      };

      const saved = await okrsRepository.upsert(input, company.id);

      // NEW: Recalculate snapshot shape
      const newSnapshot = await okrService.calculateSnapshotShapeForProject(
        projectId,
        company.id
      );

      // NEW: Update strategy_data.snapshot
      await updateStrategySnapshot(strategyId, {
        departments: [{
          id: departmentId,
          projects: [{
            id: projectId,
            okrs: newSnapshot,
          }],
        }],
      });

      // Refresh UI
      setProjectsWithOkrs(prev =>
        prev?.map(p => p.id === projectId
          ? { ...p, resolvedOkrs: saved }
          : p
        )
      );
    } catch (error) {
      console.error('Failed to save OKR:', error);
    }
  };
```

## 🔄 Cutover Sequence

### Phase 1: Pre-Cutover Verification (no code changes)

- [ ] Run backfill and verify all OKRs in okrs table
- [ ] Run post-backfill validation queries
- [ ] Verify okrs_table_count = expected
- [ ] Test okrsRepository methods in staging

### Phase 2: Staged Rollout

#### Step 1: Add read-side routing (non-breaking)
- [ ] Deploy resolveProjectsWithOkrs() with DB-primary logic
- [ ] Add feature flag: `USE_OKR_TABLE_PRIMARY = false` (default: snapshot)
- [ ] okr/page.tsx reads from both sources internally
- [ ] No visible changes to users

#### Step 2: Enable feature flag gradually
- [ ] Toggle for internal testing: `USE_OKR_TABLE_PRIMARY = true`
- [ ] Verify UI behavior matches snapshot-only version
- [ ] Monitor for data mismatches or corruption
- [ ] A/B test with subset of users

#### Step 3: Enable for all users
- [ ] Remove feature flag conditional
- [ ] All reads use okrs table as primary
- [ ] Snapshot serves as read-only fallback

#### Step 4: Write-side migration
- [ ] Update OKR create/edit to write to okrs table
- [ ] Calculate snapshot shape after each mutation
- [ ] Update strategy_data.snapshot atomically
- [ ] Monitor for write failures

### Phase 3: Post-Cutover Cleanup

- [ ] Monitor error rates and data consistency
- [ ] Verify soft delete filtering works correctly
- [ ] Test rollback procedures
- [ ] Document snapshot maintenance procedures

## 🛡️ Safety Checks

### Pre-Cutover Validation

```typescript
// Verify okrs table is ready
async function validateOkrsTableReadiness(): Promise<boolean> {
  // 1. Check RLS is enabled
  const { data: rls } = await supabase.rpc('check_rls', { table: 'okrs' });
  if (!rls?.[0]?.enabled) return false;

  // 2. Check all indexes exist
  const { data: indexes } = await supabase.rpc('list_indexes', { table: 'okrs' });
  if (!indexes || indexes.length < 6) return false;

  // 3. Check okrs_table_count matches backfill expectation
  const { data: count } = await supabase.rpc('count_okrs', {});
  if (!count || count[0].total < 100) return false;  // Sanity check

  return true;
}

// Feature flag safety
const USE_OKR_TABLE_PRIMARY = process.env.NEXT_PUBLIC_USE_OKR_TABLE_PRIMARY === 'true';
```

### During Cutover Monitoring

```typescript
// Track source usage
interface OkrSourceMetrics {
  dbHits: number;
  snapshotHits: number;
  mismatches: number;  // Data consistency check
}

// After each resolveProjectsWithOkrs() call
const metrics = {
  dbCount: dbOkrs?.length || 0,
  snapshotCount: snapshotOkrs?.length || 0,
  mismatches: countMismatches(dbOkrs, snapshotOkrs),
};

if (metrics.mismatches > 0) {
  console.warn('[OKR Cutover] Data mismatch detected:', metrics);
  // Alert ops team
}
```

## 📈 Rollback Plan

If STAGE4 cutover encounters critical issues:

### Immediate (5 minutes)
```typescript
// Disable okrs table reads
const USE_OKR_TABLE_PRIMARY = false;  // Back to snapshot-only
```

### Short-term (manual)
```sql
-- Verify snapshot integrity
SELECT COUNT(*) as okrs_in_snapshot
FROM strategy_data
WHERE snapshot->>'okrs' IS NOT NULL;

-- Compare with okrs table
SELECT COUNT(*) as okrs_in_table FROM okrs WHERE is_deleted = false;
```

### Full rollback
1. Disable all okrs table writes (snapshot becomes authoritative again)
2. Investigate data discrepancies
3. Re-run backfill if needed
4. Plan corrective measures

## 📋 Checklist for STAGE4 Cutover

### Pre-Cutover
- [ ] Backfill completed successfully
- [ ] All validation queries passed
- [ ] okrs table RLS enabled and tested
- [ ] All indexes created
- [ ] Soft delete behavior verified
- [ ] okrsRepository methods tested in staging

### Code Changes
- [ ] okr/page.tsx updated to use resolveProjectsWithOkrs()
- [ ] OKR create/edit forms updated to write to okrs table
- [ ] OKR reorder logic updated to use batchUpdateSortOrder()
- [ ] OKR delete logic updated to use softDelete()
- [ ] Feature flag added and tested
- [ ] Error handling for DB vs snapshot conflicts

### Monitoring
- [ ] Logging added for all DB operations
- [ ] Metrics tracking source usage
- [ ] Data mismatch detection enabled
- [ ] Alerting configured for failures
- [ ] Team on standby for cutover

### Post-Cutover
- [ ] Monitor error rates for 24 hours
- [ ] Verify data consistency between okrs table and snapshot
- [ ] Test critical OKR workflows (create, edit, delete, reorder)
- [ ] Confirm soft delete filtering works
- [ ] Document any issues or edge cases

## 🎯 Success Criteria

- [ ] All OKRs displayed correctly from okrs table
- [ ] Create/edit/delete operations work seamlessly
- [ ] Reordering maintains correct sort_order
- [ ] Soft delete hides deleted OKRs from all reads
- [ ] snapshot serves as read-only fallback
- [ ] Error rate < 0.1% during cutover
- [ ] Data consistency > 99.9% (okrs table vs snapshot)

## 🔗 Related Documents

- `PHASE_2A_SUPABASE_MIGRATION.sql` - Table/index/RLS creation
- `PHASE_2A_BACKFILL_SPEC.md` - Backfill strategy details
- `PHASE_2A_BACKFILL_IMPLEMENTATION.md` - How to run backfill
- `okrService.ts` - resolveProjectsWithOkrs() implementation
- `okrsRepository.ts` - CRUD operations

## 📞 Questions & Decisions

**Q1**: Should we keep snapshot updated in real-time or batch update?
**A1**: Real-time updates to ensure consistency. Each DB write triggers snapshot recalculation.

**Q2**: What happens if snapshot update fails?
**A2**: DB write succeeds, snapshot stale. Next read will refresh from DB. Log warning.

**Q3**: How long to keep feature flag?
**A3**: Minimum 1 week production data before removing. Allows quick rollback if needed.

**Q4**: okrsV2 projects - should they be included?
**A4**: No. Phase 2C handles okrsV2→KR table migration. STAGE4 only covers okrs[] → okrs table.

---

**Last Updated**: 2026-03-16
**Next Phase**: Execute post-backfill, then begin STAGE4 code modifications
**Target Completion**: Within 1 week of successful backfill
