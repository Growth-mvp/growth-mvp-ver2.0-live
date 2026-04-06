# STAGE5 dbOkrId Resolution Failure - Root Cause Analysis

## Executive Summary

**Root Cause**: projectId fallback mismatch across STAGE4 (okr/page.tsx) and STAGE5 (execution/page.tsx)

- STAGE4 saves OKRs with fallback: `proj.id ?? proj.title`
- STAGE5 looks them up with fallback: `proj.id ?? 'no-project'`
- When `proj.id = undefined`, DB has `project_id = "title_string"` but STAGE5 seeks `"no-project"`
- **Result**: mapHit = false, dbOkrId = undefined, save fails

---

## 1. Project ID Assignment Flow

### STAGE3 (cascade/page.tsx)

**Lines 2179-2187: `toProjectFromDraft()` - NO ID ASSIGNMENT**
```typescript
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';
  return {
    title,
    reason: d.reason,
    hypothesis: d.hypothesis,
    okrs: [],
  } as Project;  // ← NO id field
};
```

**Lines 1162-1171: `toProjectFromDraftWithMetadata()` - ID ADDED CONDITIONALLY**
```typescript
const projectId = genIdByTitle(title, deptName);  // Stable hash-based ID
const p: Project = { title, hypothesis, ... } as any;
(p as any).id = projectId;  // ID assigned HERE
```

**Critical Issue**: Not all projects go through `toProjectFromDraftWithMetadata()`. Some may remain without IDs.

### Project ID Generation Strategy

**genIdByTitle() (lines 211-221)**:
- Creates stable hash from `title + deptName`
- Format: `proj-${Math.abs(hash).toString(36)}`
- Example output: `proj-1a2b3c`

---

## 2. OKR Creation & projectId Persistence

### STAGE4 (okr/page.tsx)

**Line 1037: `ensureMainOkrIsDbBacked()` - SAVES WITH PROJECTID FALLBACK**
```typescript
const projectId = String(proj?.id ?? proj?.title ?? '');
// ... saves to DB with project_id = projectId
```

**Line 1098: `updateProjectOKRDb()` - SAME FALLBACK PATTERN**
```typescript
const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');
```

**Lines 1260, 1322**: Delete and reorder operations use identical fallback

**Key Observation**: When `proj.id = undefined`, database receives `project_id = proj.title` (a string like "Learning Program")

---

## 3. Database Schema Constraints

### okrs Table Structure (PHASE_2A_SUPABASE_MIGRATION.sql)

**Lines 10-50**:
```sql
CREATE TABLE okrs (
  ...
  project_id TEXT NOT NULL,     -- ★ TEXT type, NOT UUID
  ...
  UNIQUE(strategy_id, department_id, project_id, id) WHERE is_deleted = false
)
```

**Critical Constraints**:
- `project_id` is **TEXT type** (not UUID)
- `project_id` is **NOT NULL** (must have value)
- Unique constraint: `(strategy_id, department_id, project_id, id)`
- Backfill: Project.id must exist (line 265)

---

## 4. STAGE5 Lookup Failure Mechanism

### dbOkrMap Construction (execution/page.tsx, Lines 1690-1698)

```typescript
const map: Record<string, string> = {};
data.forEach((okr) => {
  if (okr?.id && okr?.objective) {
    const normalizedObjective = normalizeObjectiveKey(okr.objective);
    const projectId = okr.project_id || 'no-project';  // ← FALLBACK 1
    const key = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`;
    map[key] = okr.id;
  }
});
```

**Example populated map**:
```
Key in DB:     "company-uuid::strategy-uuid::Learning Program::Growth Mindset"
               (from STAGE4 fallback: proj.id undefined → proj.title saved)
```

### dbOkrId Lookup (execution/page.tsx, Lines 1849-1855)

```typescript
if (objective && scopeCompanyId && scopeStrategyId) {
  const normalizedObjective = normalizeObjectiveKey(objective);
  const projectIdForKey = resolvedProjId || 'no-project';  // ← FALLBACK 2
  const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;

  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;  // ← FALSE when proj.id undefined
}
```

Where `resolvedProjId = proj?.id ?? undefined` (line 1808)

**Example lookup key when proj.id = undefined**:
```
lookupKey:     "company-uuid::strategy-uuid::no-project::Growth Mindset"
               (MISMATCH: 'no-project' ≠ 'Learning Program')
```

---

## 5. The Critical Mismatch

### Scenario: Project WITHOUT ID Assigned

| Stage | Variable | Value | Key Component |
|-------|----------|-------|---|
| **STAGE3** | `proj.id` | `undefined` | ❌ No ID |
| **STAGE3** | `proj.title` | `"Learning Program"` | Has title |
| **STAGE4** | Save: `proj.id ?? proj.title` | `"Learning Program"` | ✓ Saves title as fallback |
| **DB okrs** | `project_id` | `"Learning Program"` | Stored as string |
| **STAGE5** | `resolvedProjId = proj.id` | `undefined` | ❌ Still undefined |
| **STAGE5** | Lookup: `resolvedProjId \|\| 'no-project'` | `"no-project"` | ✗ Wrong fallback |

### Lookup Key Comparison

```
DB map has:         "...::Learning Program::objective"
STAGE5 seeks:       "...::no-project::objective"
Result: NO MATCH → mapHit = false → dbOkrId = undefined → SAVE FAILS
```

---

## 6. Root Cause Classification

**Primary Cause**: Inconsistent projectId fallback strategy across stages

**Type**: Data integrity issue - **orphaned project mappings**

**Scope**: Projects created in cascade WITHOUT stable ID assignment

**Affected Flow**:
1. Cascade creates project with NO ID
2. STAGE4 saves OKR with fallback: `proj.title`
3. STAGE5 looks up OKR with different fallback: `'no-project'`
4. Lookup fails despite OKR existing in DB

---

## 7. Diagnostic Evidence

### Logging Points

**execution/page.tsx, Line 1810** (when mapHit = false):
```typescript
console.debug('[STAGE5-selection-map]', {
  projectId: resolvedProjId,           // undefined
  projectIdType: typeof resolvedProjId, // 'undefined'
  normalizedObjective: nobj,
  mapHit,
  candidates: [...],
  dbOkrId,
});
```

When `resolvedProjId = undefined`:
- Uses fallback: `'no-project'`
- But DB has: `proj.title` string value
- Candidates shown will have `project_id: "actual title"`

---

## 8. Files Requiring Fixes

| File | Lines | Issue | Fix Strategy |
|------|-------|-------|---|
| `cascade/page.tsx` | 2179-2187 | Missing ID assignment | Ensure all projects get stable IDs |
| `cascade/page.tsx` | 1162-1171 | Conditional ID assignment | Apply ID generation to all projects |
| `okr/page.tsx` | 1037, 1098, 1260, 1322 | Fallback to proj.title | Ensure proj.id is always set before using |
| `execution/page.tsx` | 1808, 1851 | Lookup with 'no-project' fallback | Match STAGE4 fallback or ensure proj.id consistency |

---

## 9. Recommended Fix Approaches

### Approach A: Force ID Consistency (Recommended)

**Ensure proj.id is ALWAYS populated in cascade before passing to later stages**

1. Modify `toProjectFromDraft()` to assign ID via `genIdByTitle()`
2. Remove all `proj.title` fallbacks in STAGE4 (okr/page.tsx)
3. All code paths use `proj.id` without fallback
4. Consequence: Simpler, more predictable behavior

### Approach B: Unified Fallback

**Use identical fallback logic across STAGE4 and STAGE5**

1. Change STAGE5 lookup to: `resolvedProjId ?? proj.title ?? 'no-project'`
2. Ensure STAGE4 uses same logic
3. Consequence: More defensive, but adds complexity with multiple fallback levels

### Approach C: Validate at Entry Points

**Add validation to reject projects without IDs**

1. Add guard in okr/page.tsx: Reject if `!proj.id`
2. Force backfill of missing IDs in migration
3. Consequence: Requires data cleanup, good for data integrity

---

## 10. Impact Assessment

**Severity**: High - Prevents comment saving for affected projects

**Affected Users**: Projects created without proper ID assignment

**Workaround**: Edit project (force ID generation via genIdByTitle), re-save OKR

**Prevention**: Ensure all project creation paths include ID assignment
