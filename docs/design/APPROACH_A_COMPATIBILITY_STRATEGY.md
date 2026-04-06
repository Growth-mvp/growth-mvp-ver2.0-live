# Approach A - projectId互換性戦略（詳細設計）

## 現状把握

### cascade/page.tsx 修正済み
```typescript
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';
  const projectId = (d as any).id || genIdByTitle(title, undefined);
  const p: Project = {
    title,
    reason: d.reason,
    hypothesis: d.hypothesis,
    okrs: [],
  } as any as Project & { id?: string };
  (p as any).id = projectId;
  return p;
};
```

**結果**: toBeLanesProjects() 経由のすべてのプロジェクトが `proj.id = proj-xxxx` を持つようになった

---

## okr/page.tsx での3つのシナリオ

### Scenario 1: 新規 OKR 追加（ensureMainOkrIsDbBacked）

**Context**:
- cascade から流れてくる project は必ず proj.id を持つ（↑上記修正済み）
- 初めて OKR を DB に保存する
- 既存の DB OKR はない

**修正戦略: Strict Mode**
```typescript
const projectId = String(proj?.id ?? '');
if (!projectId) {
  // Approach A で生成された ID がないことは異常
  console.error('[ensureMainOkrIsDbBacked] proj.id missing (data integrity failure)', {
    cacheKey,
    projTitle: proj?.title,
    // proj が null/undefined の場合の追跡
  });
  return null;  // save を skip
}
```

**理由**:
- cascade で proj.id は必ず付与されている（Approach A）
- proj.id がないのはプログラムロジックエラー
- title fallback を入れるべきではない

---

### Scenario 2: 既存 OKR 更新（updateProjectOKRDb）

**Context**:
- DB に既に OKR が存在（project_id フィールドあり）
- UI で objective/owner を修正
- project_id を再度保存する際、既存値との整合を考慮

**3つのサブケース**:

#### 2-A: 既存 OKR が "proj-xxxx" 形式（新形式）
```
DB okr.project_id = "proj-a1b2c3"
proj.id = "proj-a1b2c3"  （cascadeから）
→ 一致、新しく保存する projectId = "proj-a1b2c3" ✓
```

#### 2-B: 既存 OKR が "Learning Program" 形式（旧形式）
```
DB okr.project_id = "Learning Program"  （title で保存）
proj.id = "proj-a1b2c3"  （cascadeから新生成）
→ 不一致、どう扱うか？
```

**オプション1: Strict（新形式に統一）**
```typescript
const projectId = String(proj?.id ?? '');
// 既存の project_id = "Learning Program" は無視して
// 新しい proj.id = "proj-xxxx" で上書き保存
```

**オプション2: Conservative（既存値を保持）**
```typescript
const projectId = String(targetOkr?.project_id ?? proj?.id ?? '');
// 既存 OKR の project_id を優先
// ただし本来は同じはずなので混在はバグ
```

#### 2-C: 既存 OKR が "no-project" 形式（旧 fallback）
```
DB okr.project_id = "no-project"
proj.id = "proj-a1b2c3"
→ Approach A で修正対象、新しく proj.id で上書き
```

---

### Scenario 3: 新規 OKR 作成（addProjectOKR）

**Context**:
- UI から "Add OKR" で新規 OKR を作成
- proj.id は cascade から流れてくる
- 新規 DB insert

**修正戦略: Strict Mode**
```typescript
const projectId = proj ? String((proj as any).id ?? '') : '';
if (!projectId) {
  console.error('[addProjectOKR] proj.id missing (data integrity failure)', {
    dIdx,
    pIdx,
    projTitle: proj?.title,
  });
  alert('プロジェクト情報が取得できません');
  return;
}
```

---

## execution/page.tsx での lookup 整合

### 現在の lookup 式（修正前）
```typescript
const projectId = okr.project_id || 'no-project';
const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`;
```

**問題**: okr.project_id が複数形式（"proj-xxxx", "Learning Program", "no-project"）を持つ可能性

### okr/page.tsx での保存修正と連動
```typescript
// okr/page.tsx で保存: projectId = proj.id

// execution/page.tsx で lookup:
// - DB okr.project_id = proj.id (新形式)
// - lookup key で一致
```

---

## 推奨戦略: Approach A + Conservative Compatibility

### okr/page.tsx での実装方針

#### ensureMainOkrIsDbBacked (Scenario 1) - Strict Mode
```typescript
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[ensureMainOkrIsDbBacked] proj.id missing (Approach A violation)', {
    cacheKey,
    projTitle: proj?.title,
  });
  attemptedPromotionKeysRef.current.add(cacheKey);
  return null;  // Do not save
}

// Save with new format
await okrService.upsertOkr({
  objective,
  owner_name: owner,
  strategy_id: strategyId,
  department_id: departmentId,
  project_id: projectId,  // Always proj.id, no fallback
}, ...);
```

**根拠**: cascade で必ず proj.id が付与されているため

#### updateProjectOKRDb (Scenario 2) - Conservative Mode with warning
```typescript
// 既存 OKR の project_id を優先（互換性）
// 但し Approach A で生成された proj.id と比較
const projectIdFromProj = String(proj?.id ?? '');
const projectIdFromDb = String(targetOkr?.project_id ?? '');

if (!projectIdFromProj) {
  console.error('[updateProjectOKRDb] proj.id missing (Approach A violation)', {
    dIdx,
    pIdx,
    projTitle: proj?.title,
  });
  return;  // Do not save
}

let projectIdToUse = projectIdFromProj;
if (projectIdFromDb && projectIdFromDb !== projectIdFromProj) {
  console.warn('[updateProjectOKRDb] project_id mismatch (migrating to new format)', {
    existing: projectIdFromDb,
    newFormat: projectIdFromProj,
    action: 'using new format',
  });
  // Approach A により新形式（proj.id）に統一
  projectIdToUse = projectIdFromProj;
}

// Save with proj.id (新形式)
await okrService.upsertOkr({
  id: targetOkr.id,
  objective: dbPatch.objective ?? targetOkr.objective,
  owner_name: dbPatch.owner_name ?? targetOkr.owner,
  strategy_id: strategyId,
  department_id: departmentId,
  project_id: projectIdToUse,  // proj.id or migrated from old format
}, ...);
```

**根拠**: 既存 OKR との互換性を保ちつつ段階的に新形式へ移行

#### addProjectOKR (Scenario 3) - Strict Mode
```typescript
const projectId = proj ? String((proj as any).id ?? '') : '';
if (!projectId) {
  console.error('[addProjectOKR] proj.id missing (Approach A violation)', {
    dIdx,
    pIdx,
    projTitle: proj?.title,
  });
  alert('プロジェクト情報が取得できません');
  return;
}

// Save with new format
await okrService.upsertOkr({
  objective,
  owner_name: '',
  strategy_id: resolveCurrentStrategyId(),
  department_id: deptId,
  project_id: projectId,  // Always proj.id
}, ...);
```

**根拠**: 新規作成は常に新形式で

---

## execution/page.tsx での lookup 修正

### dbOkrMap 構築時 (Line 1694)

```typescript
const map: Record<string, string> = {};
data.forEach((okr) => {
  if (okr?.id && okr?.objective) {
    const normalizedObjective = normalizeObjectiveKey(okr.objective);

    // ★ Approach A: Expect okr.project_id to be in new format
    // Accept both formats for compatibility during migration
    let projectIdForKey = okr.project_id;

    if (!projectIdForKey) {
      console.warn('[STAGE5-dbOkrMap] okr.project_id missing (data corruption)', {
        okrId: okr.id,
        objective: okr.objective,
      });
      return;  // skip this okr
    }

    // Log migration detection for diagnostics
    if (!projectIdForKey.startsWith('proj-')) {
      console.info('[STAGE5-dbOkrMap] okr using legacy project_id format', {
        okrId: okr.id,
        projectId: projectIdForKey,
        format: 'title-based',
      });
    }

    const key = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;
    map[key] = okr.id;
  }
});
```

**戦略**:
- 新形式（proj-xxxx）と旧形式（title など）を同時にサポート
- 移行を監視するためのログ
- undefined は skip（データ破損）

### dbOkrId lookup (Line 1851)

```typescript
if (objective && scopeCompanyId && scopeStrategyId) {
  const normalizedObjective = normalizeObjectiveKey(objective);

  // ★ Approach A: proj.id should be present from cascade
  // If missing, attempt lookup with fallback for compatibility
  let projectIdForKey = resolvedProjId;

  if (!projectIdForKey) {
    console.warn('[STAGE5-lookup] proj.id missing (expected from Approach A)', {
      di,
      pi,
      deptName: dept?.name,
      projectTitle: strictProj.title,
      objective,
    });
    // Don't use 'no-project' fallback - explicit undefined
    dbOkrId = undefined;
    mapHit = false;
  } else {
    const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;
    dbOkrId = dbOkrMap[lookupKey];
    mapHit = !!dbOkrId;
  }

  // ... diagnostic logging
}
```

**戦略**:
- 'no-project' fallback を廃止
- proj.id が undefined なら明示的にログ＆lookup miss
- mapHit = false で呼び出し側に伝える

---

## 修正後のデータフロー

### パス1: 新規 OKR（ensureMainOkrIsDbBacked）
```
cascade: proj.id = "proj-a1b2c3" (Approach A)
  ↓
okr/page: projectId = proj.id (strict, no fallback)
  ↓
okrs table: project_id = "proj-a1b2c3"
  ↓
execution: resolvedProjId = "proj-a1b2c3"
  ↓
dbOkrMap: key = "...::proj-a1b2c3::objective"
  ↓
lookup: MATCH ✓
```

### パス2: 既存 OKR 更新（updateProjectOKRDb）
```
DB: okr.project_id = "Learning Program" (旧形式)
cascade: proj.id = "proj-a1b2c3" (新形式)
  ↓
okr/page: projectId = proj.id (新形式で上書き、警告ログ)
  ↓
okrs table: project_id = "proj-a1b2c3" (migrated)
  ↓
execution: resolvedProjId = "proj-a1b2c3"
  ↓
dbOkrMap: key = "...::proj-a1b2c3::objective"
  ↓
lookup: MATCH ✓ (旧エントリはlookup miss になるが再編集で修復)
```

### パス3: 新規 OKR 追加（addProjectOKR）
```
cascade: proj.id = "proj-a1b2c3" (Approach A)
  ↓
okr/page: projectId = proj.id (strict, no fallback)
  ↓
okrs table: project_id = "proj-a1b2c3"
  ↓
execution: lookup と一致
```

---

## 既存データ互換のまとめ

| シナリオ | 既存 DB | 新規保存 | 互換対応 |
|--------|--------|--------|--------|
| 新規 OKR | N/A | proj.id | N/A |
| OKR 更新（旧形式DB） | "title" | proj.id | ⚠️ 警告ログ＋上書き |
| OKR 更新（新形式DB） | "proj-xxxx" | proj.id | ✓ 一致 |
| OKR 更新（broken） | "no-project" | proj.id | ⚠️ 警告ログ＋修復 |

---

## まとめ: 修正内容

### okr/page.tsx - 3箇所の修正

#### 1. ensureMainOkrIsDbBacked() (Line 1037)
```typescript
// Before:
const projectId = String(proj?.id ?? proj?.title ?? '');

// After (Strict):
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[ensureMainOkrIsDbBacked] proj.id missing (Approach A violation)', ...);
  return null;  // No save
}
```

#### 2. updateProjectOKRDb() (Line 1098)
```typescript
// Before:
const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');

// After (Conservative with warning):
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[updateProjectOKRDb] proj.id missing (Approach A violation)', ...);
  return;  // No save
}
if (targetOkr?.project_id && targetOkr.project_id !== projectId) {
  console.warn('[updateProjectOKRDb] project_id mismatch (migrating)', {
    existing: targetOkr.project_id,
    newFormat: projectId,
  });
}
// Save with projectId (new format)
```

#### 3. addProjectOKR() (Line 1260)
```typescript
// Before:
const projectId = proj ? String((proj as any).id ?? proj.title) : '';

// After (Strict):
const projectId = proj ? String((proj as any).id ?? '') : '';
if (!projectId) {
  console.error('[addProjectOKR] proj.id missing (Approach A violation)', ...);
  alert('プロジェクト情報が取得できません');
  return;  // No save
}
```

### execution/page.tsx - 2箇所の修正

#### 1. dbOkrMap 構築 (Line 1694)
```typescript
// Before:
const projectId = okr.project_id || 'no-project';

// After:
if (!okr.project_id) {
  console.warn('[STAGE5-dbOkrMap] okr.project_id missing', ...);
  return;  // skip
}
const projectId = okr.project_id;
if (!projectId.startsWith('proj-')) {
  console.info('[STAGE5-dbOkrMap] legacy format detected', ...);
}
```

#### 2. dbOkrId lookup (Line 1851)
```typescript
// Before:
const projectIdForKey = resolvedProjId || 'no-project';

// After:
if (!resolvedProjId) {
  console.warn('[STAGE5-lookup] proj.id missing', ...);
  dbOkrId = undefined;
  mapHit = false;
} else {
  const lookupKey = `...::${resolvedProjId}::...`;
  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;
}
```

---

## チェックリスト

修正前：
- [ ] cascade での proj.id 付与が完成している（✓ 完了）
- [ ] 3つのシナリオの違いを理解している

修正後：
- [ ] proj.id がない場合は save を skip（エラーガード）
- [ ] 既存 OKR の project_id ミスマッチは warning + 新形式に統一
- [ ] execution での 'no-project' fallback は廃止
- [ ] proj.id undefined なら lookup miss が明示的

---

## 互換性レベル

**段階1（今回）**: Approach A strict mode + Conservative update mode
- 新規 OKR は proj.id 強制
- 既存 OKR 更新時は警告で旧形式から新形式に移行
- execution での 'no-project' は廃止

**段階2（将来）**: Migration script で一括修復
```sql
UPDATE okrs
SET project_id = 'proj-' || substr(md5('::' || title), 1, 6)
WHERE project_id NOT LIKE 'proj-%'
  AND strategy_id = ?;
```

