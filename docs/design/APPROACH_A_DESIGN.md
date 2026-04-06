# Approach A - Project ID統一修正設計書

## 修正概要

projectIdの fallback 不一致問題を根本修復するため、全プロジェクトが必ず安定IDを持つように統一する。

---

## 1. toProjectFromDraft() 修正設計

### 変更前
```typescript
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';
  return {
    title,
    reason: d.reason,
    hypothesis: d.hypothesis,
    okrs: [],
  } as Project;  // ← ID がない！
};
```

**問題点**:
- ApiProjectDraft から Project に変換時、ID が付与されない
- toLanesProjects で lanes.existing/new から生成されるプロジェクトが ID なしで流れる
- これらが cascade → okr → execution で ID なしのまま進む

### 変更後
```typescript
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';

  // ★ Approach A: Always assign stable ID (ensures no ID-less projects)
  // - deptName not available in this context, use title-only generation
  // - Matches genIdByTitle strategy in normalizeProjectDraft (line 1162)
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

**改善点**:
- ✓ API応答に既に id がある場合は尊重: `(d as any).id || ...`
- ✓ 既に id がない場合は genIdByTitle で生成
- ✓ genIdByTitle(title, undefined) で安定ID作成（毎回同じ値）
- ✓ normalizeProjectDraft (line 1162) と同じ戦略

---

## 2. ID 生成式

### genIdByTitle() （既存関数、変更なし）
**Location**: cascade/page.tsx, Lines 211-221

```typescript
function genIdByTitle(title: string, deptName?: string): string {
  const normalized = `${deptName || ''}::${title}`.trim().toLowerCase();
  // 簡易 hash（本番なら crypto.subtle.digest）
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `proj-${Math.abs(hash).toString(36)}`;
}
```

### 使用例

| Scenario | Input | deptName | Output |
|----------|-------|----------|--------|
| 通常プロジェクト | title: "Learning Program" | undefined | `proj-a1b2c3` (stable) |
| 同名複数 (後で okr.page で区別) | title: "Learning Program" | undefined | `proj-a1b2c3` (same) |
| AI生成時 | title: "成長マインド向上" | "営業部" | `proj-x9y8z7` (with dept context) |
| 空タイトル補完後 | title: "（未設定プロジェクト）" | undefined | `proj-d4e5f6` (stable) |

**特性**:
- ✓ 同じ title から毎回同じ ID を生成（安定）
- ✓ deptName がない場合は title のみで生成
- ✓ Hash ベースなので ID 衝突は理論上可能（但し実運用ではほぼ無視可能）

---

## 3. 既存 project.id がある場合の扱い

### toProjectFromDraft() での扱い

```typescript
const projectId = (d as any).id || genIdByTitle(title, undefined);
```

| Case | d.id | Result |
|------|------|--------|
| API応答に id 付き | `"proj-existing"` | `"proj-existing"` (使用) |
| API応答に id なし | undefined | `genIdByTitle(title, ...)` (生成) |
| 既存 project merge | ✓ (mergeCascadeFields で引き継がれる) | 変わらない |

**処理フロー**:
1. `toProjectFromDraft(apiDraft)` で id を生成/取得
2. `toLanesProjects()` で lanes.existing/new プロジェクトに ID を付与
3. `applyDeptDraftToProjects()` で既存プロジェクトと merge
4. **merge時**: `mergeCascadeFields()` で既存プロジェクトの okrs/owner等を引き継ぐ

---

## 4. 同名プロジェクトが複数ある場合の扱い

### 現在の設計（title ベース重複排除）

**dedupeProjectsByTitle()** （cascade/page.tsx）:
```typescript
// 同名プロジェクトは最後の出現を保持
const deduped = dedupeProjectsByTitle([...projects]);
```

### Approach A での同名プロジェクト処理

**Scenario**: 同じ部門内に "Learning Program" が複数来た場合

| Flow | Result |
|------|--------|
| Lane1: "Learning Program" | ID: `proj-a1b2c3` |
| Lane2: "Learning Program" (dup) | ID: `proj-a1b2c3` (same) |
| dedupeProjectsByTitle() | 後者が前者を上書き |

**結果**:
- ✓ 同名は ID で認識可能（`proj-a1b2c3`）
- ✓ okr.page で同じ projectId を持つ OKR は同一プロジェクトとして扱われる
- ✓ execution.page で同じ projectId を持つ OKR は同一 dbOkrId に lookup

**STAGE4 (okr/page) での処理**:
```typescript
// Line 1037 修正後：
const projectId = String(proj?.id ?? '');  // id は必ず存在
```

同名でも proj.id が同じなら同じ OKR として DB に保存される。

---

## 5. 修正対象ファイル一覧

### ファイル 1: cascade/page.tsx

#### 修正1-1: toProjectFromDraft() (Lines 2179-2187)
- **追加**: projectId 生成ロジック
- **追加**: project に id を付与
- **統一**: normalizeProjectDraft() と同じ戦略

#### 修正1-2: toLanesProjects() (Lines 2192-2208)
- **変更なし**: toProjectFromDraft() の修正が cascade される

---

### ファイル 2: okr/page.tsx

#### 修正2-1: ensureMainOkrIsDbBacked() (Line 1037)
```typescript
// Before:
const projectId = String(proj?.id ?? proj?.title ?? '');

// After:
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.warn('[ensureMainOkrIsDbBacked] proj.id missing despite Approach A', { cacheKey, proj });
  attemptedPromotionKeysRef.current.add(cacheKey);
  return null;
}
```

#### 修正2-2: updateProjectOKRDb() (Line 1098)
```typescript
// Before:
const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');

// After:
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.warn('[updateProjectOKRDb] proj.id missing', { pIdx, proj });
  return;
}
```

#### 修正2-3: addProjectOKR() (Line 1260)
```typescript
// Before:
const projectId = proj ? String((proj as any).id ?? proj.title) : '';

// After:
const projectId = proj ? String((proj as any).id ?? '') : '';
if (!projectId) {
  alert('プロジェクト情報が取得できません');
  return;
}
```

---

### ファイル 3: execution/page.tsx

#### 修正3-1: dbOkrMap 構築 (Line 1694)
```typescript
// Before:
const projectId = okr.project_id || 'no-project';
const key = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`;
map[key] = okr.id;

// After:
// Approach A: DB okrs should have valid project_id (saved by okr.page)
// If missing, it indicates data corruption - skip this entry
if (!okr.project_id) {
  console.warn('[STAGE5-dbOkrMap] okr.project_id missing', { okrId: okr.id, objective: okr.objective });
  // skip this okr from map
  return;
}
const key = `${scopeCompanyId}::${scopeStrategyId}::${okr.project_id}::${normalizedObjective}`;
map[key] = okr.id;
```

#### 修正3-2: dbOkrId lookup (Line 1851)
```typescript
// Before:
const projectIdForKey = resolvedProjId || 'no-project';
const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;
dbOkrId = dbOkrMap[lookupKey];
mapHit = !!dbOkrId;

// After:
// Approach A: proj.id should always exist (generated in cascade/toProjectFromDraft)
// If missing, it indicates a data issue - explicit fail
if (!resolvedProjId) {
  console.warn('[STAGE5-lookup] proj.id missing despite Approach A', {
    di, pi, deptName: dept?.name, projectTitle: strictProj.title, objective
  });
  dbOkrId = undefined;
  mapHit = false;
  // Return existing selection object with mapHit: false
} else {
  const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${resolvedProjId}::${normalizedObjective}`;
  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;
}
```

---

## 6. Data Flow (修正後)

```
STAGE3 (cascade/page.tsx)
  └─ ApiProjectDraft (with or without id)
     └─ toProjectFromDraft()
        └─ projectId = d.id || genIdByTitle(title, undefined)
           └─ Project { id: "proj-xxxx", title, ... }
              └─ toLanesProjects() → Department.lanes
                 └─ applyDeptDraftToProjects() → Department.projects
                    └─ saved to Zustand store

STAGE4 (okr/page.tsx)
  └─ Department.projects[]
     └─ proj.id = "proj-xxxx" (always present)
        └─ ensureMainOkrIsDbBacked()
           └─ upsertOkr({ ..., project_id: proj.id, ... })
              └─ okrs table: (strategy_id, department_id, project_id="proj-xxxx", objective)

STAGE5 (execution/page.tsx)
  └─ Fetch okrs from DB
     └─ dbOkrMap: key = "...::proj-xxxx::objective" → okr.id
        └─ Department.projects[] with proj.id = "proj-xxxx"
           └─ lookupKey = "...::proj-xxxx::objective" (MATCH!)
              └─ dbOkrId = map[lookupKey] ✓
```

---

## 7. 既存データ救済（Backward Compatibility）

### シナリオ
既に projectId 不整合がある戦略:
- cascade に `proj.id = undefined` のプロジェクトが存在
- okrs table に `project_id = "Learning Program"` で保存されている

### 自動修復パス
1. **STAGE3 読込**: `refetchFromServer()` で cascade 復元
   - 既存プロジェクトは `mergeCascadeFields()` で merge
   - id なしプロジェクトは `toProjectFromDraft()` で id を生成

2. **STAGE4 アクセス**: okr/page
   - 新しい proj.id で OKR を upsert
   - DB には新しい project_id で保存

3. **STAGE5 lookup**:
   - 新しい proj.id で lookup → OK
   - 古い project_id のエントリは lookup miss（但し旧データは DB に残る）

### 推奨: Migration Script（将来）
```sql
-- 旧データの projectId を正規化（例：title → genIdByTitle 生成値）
UPDATE okrs
SET project_id = 'proj-' || substr(md5('::' || title), 1, 6)
WHERE project_id NOT LIKE 'proj-%'
  AND strategy_id = ?;
```

---

## 8. 修正順序

1. **cascade/page.tsx**: toProjectFromDraft() に ID生成を追加
2. **okr/page.tsx**: projectId fallback を削除
3. **execution/page.tsx**: 'no-project' fallback を削除
4. **テスト**: ID なしプロジェクト → STAGE4 save → STAGE5 lookup

---

## 9. 検証チェックリスト

修正後、以下を確認:

- [ ] toProjectFromDraft() が常に project.id を返す
- [ ] toLanesProjects() 経由でも ID が付く
- [ ] okr/page の projectId が常に proj.id（fallback なし）
- [ ] execution/page の lookup が proj.id で成功
- [ ] 'no-project' fallback が完全に削除
- [ ] console.warn でロギングされている（デバッグ用）

---

## 10. サマリー表

| 項目 | 変更前 | 変更後 |
|------|------|------|
| **toProjectFromDraft()** | id なし | id: genIdByTitle(title, undefined) |
| **genIdByTitle 方針** | normalizeProjectDraft のみ | toProjectFromDraft でも統一 |
| **okr.page projectId** | `proj.id ?? proj.title ?? ''` | `proj.id ?? ''` + guard |
| **execution.page lookup** | `resolvedProjId \|\| 'no-project'` | `resolvedProjId` + guard |
| **dbOkrMap key** | `::no-project::` possible | `::proj-xxxx::` guaranteed |
| **mapHit failure cause** | fallback mismatch | データ破損検出（rare） |

