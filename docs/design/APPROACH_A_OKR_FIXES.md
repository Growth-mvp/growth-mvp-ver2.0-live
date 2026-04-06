# Approach A - OKR/Execution projectId 修正詳細

## 修正対象の3箇所と修正内容

### 1. okr/page.tsx - ensureMainOkrIsDbBacked() (Line 1037)

#### 修正前
```typescript
const projectId = String(proj?.id ?? proj?.title ?? '');
const departmentId = String(dept?.id ?? dept?.name ?? '');
const strategyId = resolveCurrentStrategyId();
if (!projectId || !departmentId || !strategyId) {
  console.warn('[ensureMainOkrIsDbBacked] missing identifiers', { cacheKey, projectId, departmentId, strategyId });
  attemptedPromotionKeysRef.current.add(cacheKey);
  return null;
}
```

**問題点**: proj.title fallback を使用。proj.id がない場合、title 文字列で保存される。

#### 修正後
```typescript
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
// No fallback to proj.title - if proj.id is missing, data integrity issue
const projectId = String(proj?.id ?? '');
const departmentId = String(dept?.id ?? dept?.name ?? '');
const strategyId = resolveCurrentStrategyId();
if (!projectId || !departmentId || !strategyId) {
  console.warn('[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)', {
    cacheKey,
    projectId,
    projId: (proj as any)?.id,
    projTitle: proj?.title,
    departmentId,
    strategyId,
  });
  attemptedPromotionKeysRef.current.add(cacheKey);
  return null;
}
```

**改善点**:
- ✓ proj.id を唯一の正本として使用
- ✓ proj.title fallback を廃止
- ✓ Guard: projectId が empty なら早期 return、DB save を回避
- ✓ ログで proj.id と proj.title を区別表示（デバッグ用）

---

### 2. okr/page.tsx - updateProjectOKRDb() (Line 1098)

#### 修正前
```typescript
const dept = departments?.[dIdx] as any;
const proj = dept?.projects?.[pIdx] as any;
const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');
const strategyId = resolveCurrentStrategyId();
const departmentId = String(dept?.id ?? dept?.name ?? '');

await okrService.upsertOkr(
  {
    id: targetOkr.id,
    objective: dbPatch.objective ?? targetOkr.objective,
    owner_name: dbPatch.owner_name ?? targetOkr.owner,
    strategy_id: strategyId,
    department_id: departmentId,
    project_id: projectId,
  },
  projectId,
  accessCompanyId
);
```

**問題点**: proj.title と targetOkr.id の多重 fallback。複数の値から選ぶことで一貫性が失われる。

#### 修正後
```typescript
const dept = departments?.[dIdx] as any;
const proj = dept?.projects?.[pIdx] as any;
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
const projectId = String(proj?.id ?? '');
const strategyId = resolveCurrentStrategyId();
const departmentId = String(dept?.id ?? dept?.name ?? '');

if (!projectId) {
  console.warn('[updateProjectOKRDb] proj.id missing (data integrity issue)', {
    dIdx,
    pIdx,
    projId: (proj as any)?.id,
    projTitle: proj?.title,
    targetOkrId: targetOkr?.id,
    targetOkrProjectId: targetOkr?.project_id,
  });
  return;
}

await okrService.upsertOkr(
  {
    id: targetOkr.id,
    objective: dbPatch.objective ?? targetOkr.objective,
    owner_name: dbPatch.owner_name ?? targetOkr.owner,
    strategy_id: strategyId,
    department_id: departmentId,
    project_id: projectId,
  },
  projectId,
  accessCompanyId
);
```

**改善点**:
- ✓ proj.id を唯一の正本として使用
- ✓ proj.title と targetOkr.id fallback を廃止
- ✓ Guard: projectId が empty なら早期 return
- ✓ 既存 OKR (targetOkr) の project_id との整合性をログ出力

---

### 3. okr/page.tsx - addProjectOKR() (Line 1260)

#### 修正前
```typescript
// プロジェクト情報を departments から取得
const dept = departments?.[dIdx];
const proj = dept?.projects?.[pIdx];
const projectId = proj ? String((proj as any).id ?? proj.title) : '';
const deptId = dept ? String((dept as any).id ?? dept.name) : '';

if (!projectId) {
  alert('プロジェクト情報が取得できません');
  return;
}
```

**問題点**: proj.title fallback を使用。`proj ? ... : ''` という形で proj が存在しても projectId が empty になる可能性がある。

#### 修正後
```typescript
// プロジェクト情報を departments から取得
const dept = departments?.[dIdx];
const proj = dept?.projects?.[pIdx];
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
const projectId = proj ? String((proj as any).id ?? '') : '';
const deptId = dept ? String((dept as any).id ?? dept.name) : '';

if (!projectId) {
  console.warn('[addProjectOKR] proj.id missing (data integrity issue)', {
    dIdx,
    pIdx,
    projExists: !!proj,
    projId: proj ? (proj as any).id : undefined,
    projTitle: proj?.title,
  });
  alert('プロジェクト情報が取得できません');
  return;
}
```

**改善点**:
- ✓ proj.id を唯一の正本として使用
- ✓ proj.title fallback を廃止
- ✓ Guard: projectId が empty なら alert＆early return
- ✓ ログで proj.id の有無を詳細に記録

---

## execution/page.tsx での整合修正

### 修正対象1: dbOkrMap 構築時 (Line 1694)

#### 修正前
```typescript
const map: Record<string, string> = {};
data.forEach((okr) => {
  if (okr?.id && okr?.objective) {
    const normalizedObjective = normalizeObjectiveKey(okr.objective);
    const projectId = okr.project_id || 'no-project';  // ← fallback
    const key = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`;
    map[key] = okr.id;
  }
});
```

**問題点**: `okr.project_id || 'no-project'` fallback により、DB に保存された project_id = 'no-project' と実際の project_id が混在する。

#### 修正後
```typescript
const map: Record<string, string> = {};
data.forEach((okr) => {
  if (okr?.id && okr?.objective) {
    // ★ Approach A: okr.project_id must exist (saved by okr.page with proj.id)
    if (!okr.project_id) {
      console.warn('[STAGE5-dbOkrMap] okr.project_id missing (data corruption)', {
        okrId: okr.id,
        objective: okr.objective,
        strategyId: okr.strategy_id,
      });
      return;  // skip this okr from map
    }
    const normalizedObjective = normalizeObjectiveKey(okr.objective);
    const key = `${scopeCompanyId}::${scopeStrategyId}::${okr.project_id}::${normalizedObjective}`;
    map[key] = okr.id;
  }
});
```

**改善点**:
- ✓ 'no-project' fallback を廃止
- ✓ okr.project_id が missing のエントリは map から除外
- ✓ データ破損検出とログ出力

---

### 修正対象2: dbOkrId lookup (Line 1851)

#### 修正前
```typescript
if (objective && scopeCompanyId && scopeStrategyId) {
  const normalizedObjective = normalizeObjectiveKey(objective);
  const projectIdForKey = resolvedProjId || 'no-project';  // ← fallback
  const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;

  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;

  // ... diagnostic logging
}
```

**問題点**: `resolvedProjId || 'no-project'` により、cascade で proj.id が undefined のプロジェクトは 'no-project' キーで lookup。okr.page で proj.title で保存された OKR と不整合。

#### 修正後
```typescript
if (objective && scopeCompanyId && scopeStrategyId) {
  const normalizedObjective = normalizeObjectiveKey(objective);

  // ★ Approach A: resolvedProjId must exist (generated in cascade/toProjectFromDraft)
  if (!resolvedProjId) {
    console.warn('[STAGE5-lookup] proj.id missing (data integrity issue)', {
      di,
      pi,
      objective,
      deptName: dept?.name,
      projectTitle: strictProj.title,
    });
    dbOkrId = undefined;
    mapHit = false;
  } else {
    const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${resolvedProjId}::${normalizedObjective}`;
    dbOkrId = dbOkrMap[lookupKey];
    mapHit = !!dbOkrId;
  }

  // ... diagnostic logging (conditional on resolvedProjId existing)
}
```

**改善点**:
- ✓ 'no-project' fallback を廃止
- ✓ resolvedProjId が missing なら早期に dbOkrId = undefined を設定
- ✓ データ破損検出とログ出力
- ✓ mapHit が false になる明確な理由が logging に反映

---

## データフロー整合確認

### OKR保存パス（okr/page.tsx → okrs table）

```
ensureMainOkrIsDbBacked() / updateProjectOKRDb() / addProjectOKR()
  ↓
  projectId = proj.id (no fallback)
  ↓
  okrService.upsertOkr({ ..., project_id: projectId, ... })
  ↓
  okrs table: project_id = proj.id (always present)
```

### OKR読込パス（okrs table → dbOkrMap）

```
STAGE5 fetch okrs
  ↓
  forEach(okr)
    └─ if (!okr.project_id) skip (data corruption detection)
       else map[key with okr.project_id] = okr.id
  ↓
  dbOkrMap: all keys have valid project_id
```

### OKR lookup パス（cascade → execution lookup）

```
cascade: proj.id = genIdByTitle(title, undefined) (Approach A)
  ↓
  execution: resolvedProjId = proj.id (always present)
  ↓
  lookup: lookupKey = "...::proj.id::objective"
  ↓
  dbOkrMap[lookupKey] → okr.id (MATCH!)
```

---

## 修正チェックリスト

修正前に確認：
- [ ] cascade/page.tsx: toProjectFromDraft() は常に project.id を返す
- [ ] okr/page.tsx: 3箇所ともプロジェクトが存在する前提
- [ ] execution/page.tsx: proj.id は cascade で常に付与されている前提

修正後に確認：
- [ ] ensureMainOkrIsDbBacked: projectId は proj.id のみ、guard あり
- [ ] updateProjectOKRDb: projectId は proj.id のみ、guard あり
- [ ] addProjectOKR: projectId は proj.id のみ、guard あり
- [ ] dbOkrMap: 'no-project' fallback 廃止、skip logic あり
- [ ] dbOkrId lookup: 'no-project' fallback 廃止、proj.id check あり

---

## 想定される修正後の動作

### Success Case: proj.id が正常に付与されている
```
cascade: proj.id = "proj-a1b2c3"
okr/page: projectId = "proj-a1b2c3" → upsert
okrs table: project_id = "proj-a1b2c3"
execution: resolvedProjId = "proj-a1b2c3" → lookup → MATCH ✓
```

### Failure Case: 既存データが proj.id 不整合（rare）
```
cascade: proj.id = undefined (old data)
okr/page: guard で早期 return、DB save なし
execution: resolvedProjId = undefined → guard で dbOkrId = undefined
```

このケースではログが出力され、データ破損を明示的に検出できる。

---

## 既存データ互換性

Approach A により、新規作成や編集時は必ず proj.id で保存される。
既存の不整合データ（project_id = title）は lookup miss になるが、
再編集時に新しい project_id で OKR が再作成される（段階的修復）。

必要に応じて migration script で一括修復可能：
```sql
UPDATE okrs
SET project_id = 'proj-' || substr(md5('::' || title), 1, 6)
WHERE project_id NOT LIKE 'proj-%'
  AND strategy_id = ?;
```

