# Approach A実装レポート

## 実装完了日
2026-04-06

## 実装概要

STAGE5（execution）でのdbOkrId lookup失敗を根本修復するため、projectIdの一貫性を全体で強制した。

**根本原因**: cascadeで付与されないprojId → okr/pageでtitle fallback使用 → execution/pageで'no-project' fallbackでmismatch

**修正方針**: Approach A strict + Conservative update
- 新規OKR: proj.idで保存（fallbackなし）
- 既存OKR: proj.idに統一（警告ログ+旧形式から新形式に移行）
- execution lookup: 'no-project' fallback廃止、proj.id必須化

---

## 修正対象ファイル

### 1. /app/cascade/page.tsx（修正済み）

**関数**: `toProjectFromDraft()` (Lines 2179-2197)

**修正内容**:
```typescript
// Before:
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';
  return {
    title,
    reason: d.reason,
    hypothesis: d.hypothesis,
    okrs: [],
  } as Project;  // ← NO id
};

// After:
const toProjectFromDraft = (d: ApiProjectDraft): Project => {
  const title = (d.title ?? '').trim() || '（未設定プロジェクト）';

  // ★ Approach A: Always assign stable ID via genIdByTitle
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

**効果**: toLanesProjects() 経由のすべてのプロジェクトが必ず proj.id を持つようになった

---

### 2. /app/okr/page.tsx（修正3箇所）

#### 修正2-1: ensureMainOkrIsDbBacked() (Lines 1037-1053)

**修正前**:
```typescript
const projectId = String(proj?.id ?? proj?.title ?? '');
```

**修正後**:
```typescript
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)', {
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

**変更ポイント**:
- proj.title fallback を廃止
- projectId missing → save skip + error log
- guard: undefined のまま DB save に進まない

---

#### 修正2-2: updateProjectOKRDb() (Lines 1107-1131)

**修正前**:
```typescript
const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');
```

**修正後**:
```typescript
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
const projectId = String(proj?.id ?? '');

if (!projectId) {
  console.error('[updateProjectOKRDb] proj.id missing (data integrity issue)', {
    dIdx,
    pIdx,
    projId: (proj as any)?.id,
    projTitle: proj?.title,
    targetOkrId: targetOkr?.id,
    targetOkrProjectId: targetOkr?.project_id,
  });
  return;
}

// Conservative: Warn if existing project_id differs (migration)
if (targetOkr?.project_id && targetOkr.project_id !== projectId) {
  console.warn('[updateProjectOKRDb] project_id mismatch (migrating to new format)', {
    existing: targetOkr.project_id,
    newFormat: projectId,
    action: 'using new format',
  });
}
```

**変更ポイント**:
- proj.title と targetOkr.id fallback を廃止
- projectId missing → return skip + error log
- 既存 project_id ≠ proj.id → warning log + 新形式に統一
- 旧形式から段階的に新形式へ移行

---

#### 修正2-3: addProjectOKR() (Lines 1291-1305)

**修正前**:
```typescript
const projectId = proj ? String((proj as any).id ?? proj.title) : '';
```

**修正後**:
```typescript
// ★ Approach A: proj.id is mandatory (generated in cascade/toProjectFromDraft)
const projectId = proj ? String((proj as any).id ?? '') : '';

if (!projectId) {
  console.error('[addProjectOKR] proj.id missing (data integrity issue)', {
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

**変更ポイント**:
- proj.title fallback を廃止
- projectId missing → alert + return skip + error log
- guard: undefined のまま DB save に進まない

---

### 3. /app/execution/page.tsx（修正2箇所）

#### 修正3-1: dbOkrMap 構築 (Lines 1695-1713)

**修正前**:
```typescript
const projectId = okr.project_id || 'no-project';
const key = `${scopeCompanyId}::${scopeStrategyId}::${projectId}::${normalizedObjective}`;
map[key] = okr.id;
```

**修正後**:
```typescript
// ★ Approach A: okr.project_id must exist (saved by okr.page with proj.id)
// Do not use 'no-project' fallback - skip corrupted entries instead
if (!okr.project_id) {
  console.warn('[STAGE5-dbOkrMap] okr.project_id missing (data corruption)', {
    okrId: okr.id,
    objective: okr.objective,
    strategyId: okr.strategy_id,
  });
  return;  // skip this okr from map
}

// Log migration detection for diagnostics
if (!okr.project_id.startsWith('proj-')) {
  console.info('[STAGE5-dbOkrMap] okr using legacy project_id format', {
    okrId: okr.id,
    projectId: okr.project_id,
    format: 'title-based (legacy)',
  });
}

const key = `${scopeCompanyId}::${scopeStrategyId}::${okr.project_id}::${normalizedObjective}`;
map[key] = okr.id;
```

**変更ポイント**:
- 'no-project' fallback を廃止
- okr.project_id missing → skip + warn log
- 旧形式（title など）→ info log で移行状況を追跡
- map に格納されるのは valid project_id のエントリのみ

---

#### 修正3-2: dbOkrId lookup (Lines 1872-1888)

**修正前**:
```typescript
const projectIdForKey = resolvedProjId || 'no-project';
const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${projectIdForKey}::${normalizedObjective}`;
dbOkrId = dbOkrMap[lookupKey];
mapHit = !!dbOkrId;
```

**修正後**:
```typescript
// ★ Approach A: resolvedProjId should exist (generated in cascade/toProjectFromDraft)
// Do not use 'no-project' fallback - explicit fail with logging
if (!resolvedProjId) {
  console.warn('[STAGE5-lookup] proj.id missing (expected from Approach A)', {
    di,
    pi,
    deptName: dept?.name,
    projectTitle: strictProj.title,
    objective,
  });
  dbOkrId = undefined;
  mapHit = false;
} else {
  const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${resolvedProjId}::${normalizedObjective}`;
  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;
}
```

**変更ポイント**:
- 'no-project' fallback を廃止
- resolvedProjId missing → 明示的に dbOkrId = undefined, mapHit = false
- lookup keyは 必ず valid proj.id で構築
- データ破損を検出可能に

---

## 修正内容のまとめ表

| 項目 | 修正前 | 修正後 | 効果 |
|-----|------|------|------|
| **cascade/toProjectFromDraft** | ID なし | `genIdByTitle()` で生成 | 全プロジェクトに ID 付与 |
| **okr/ensureMainOkrIsDbBacked** | `proj.id ?? proj.title ?? ''` | `proj.id ?? ''` + guard | 新規OKR は必ず proj.id で保存 |
| **okr/updateProjectOKRDb** | `proj.id ?? proj.title ?? targetOkr.id ?? ''` | `proj.id ?? ''` + guard + warning | 既存OKR を新形式に統一（移行ログ付き） |
| **okr/addProjectOKR** | `proj?.id ?? proj.title` | `proj?.id ?? ''` + guard | 新規OKR は必ず proj.id で保存 |
| **execution/dbOkrMap** | `okr.project_id \|\| 'no-project'` | `okr.project_id` + skip logic | 新形式エントリのみ map に格納 |
| **execution/lookup** | `resolvedProjId \|\| 'no-project'` | `resolvedProjId` + explicit fail | proj.id 必須、lookup miss を明示 |

---

## データフロー修正後

### Success Path: 新規 OKR

```
cascade: proj.id = "proj-a1b2c3" (✓ Approach A で生成)
  ↓
okr/page: projectId = "proj-a1b2c3" (✓ strict, no fallback)
  ↓
DB okrs: project_id = "proj-a1b2c3"
  ↓
execution: resolvedProjId = "proj-a1b2c3"
  ↓
dbOkrMap: key = "...::proj-a1b2c3::objective" → okr.id
  ↓
lookup: ✓ MATCH → dbOkrId = okr.id, mapHit = true
```

### Migration Path: 既存 OKR（旧形式）

```
DB: okr.project_id = "Learning Program" (旧形式)
cascade: proj.id = "proj-a1b2c3" (新形式で再生成)
  ↓
okr/page (updateProjectOKRDb): warning log + proj.id で上書き
  ↓
DB okrs: project_id = "proj-a1b2c3" (⚠️ migrated)
  ↓
execution: resolvedProjId = "proj-a1b2c3"
  ↓
dbOkrMap: key = "...::proj-a1b2c3::objective" → okr.id
  ↓
lookup: ✓ MATCH (旧エントリはskip)
```

### Failure Path: proj.id なし（Approach A violation）

```
cascade: proj.id = undefined (❌ 異常)
  ↓
okr/page: projectId = undefined
  ↓
guard: ❌ save skip + console.error
  ↓
execution: resolvedProjId = undefined
  ↓
lookup: ❌ mapHit = false + console.warn
```

---

## ログ出力仕様

### okr/page.tsx での ログ

#### Error レベル（save skip）
```javascript
console.error('[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)', {
  cacheKey,
  projectId,
  projId: (proj as any)?.id,
  projTitle: proj?.title,
  departmentId,
  strategyId,
});
```

#### Warning レベル（旧形式から新形式への移行）
```javascript
console.warn('[updateProjectOKRDb] project_id mismatch (migrating to new format)', {
  existing: targetOkr.project_id,
  newFormat: projectId,
  action: 'using new format',
});
```

### execution/page.tsx でのログ

#### Warning レベル（データ破損検出）
```javascript
console.warn('[STAGE5-dbOkrMap] okr.project_id missing (data corruption)', {
  okrId: okr.id,
  objective: okr.objective,
  strategyId: okr.strategy_id,
});
```

#### Info レベル（旧形式サポート通知）
```javascript
console.info('[STAGE5-dbOkrMap] okr using legacy project_id format', {
  okrId: okr.id,
  projectId: okr.project_id,
  format: 'title-based (legacy)',
});
```

#### Warning レベル（lookup miss）
```javascript
console.warn('[STAGE5-lookup] proj.id missing (expected from Approach A)', {
  di,
  pi,
  deptName: dept?.name,
  projectTitle: strictProj.title,
  objective,
});
```

---

## 互換性対応

### 新規 OKR（Approach A 実装後）
→ 常に `proj.id` で保存、lookup も `proj.id` で成功

### 既存 OKR（旧形式: project_id = "title"）
1. STAGE4 アクセス時：updateProjectOKRDb で `proj.id` に上書き（warning log）
2. DB 更新：project_id が "proj-xxxx" 形式に更新
3. STAGE5 lookup：新しい key で match

### 既存 OKR（broken: project_id = "no-project"）
1. STAGE5 map 構築：skip（warn log）
2. lookup：mapHit = false
3. 再編集時：STAGE4 で proj.id で上書き（修復）

---

## 既存データ救済（将来の migration）

```sql
-- 旧形式（project_id != proj-xxxx）の正規化
UPDATE okrs
SET project_id = 'proj-' || substr(md5('::' || project_id), 1, 6)
WHERE project_id NOT LIKE 'proj-%'
  AND strategy_id = ?;
```

---

## 検証チェックリスト

実装完了項目：

- [x] cascade/toProjectFromDraft: 常に project.id を返す
- [x] okr/ensureMainOkrIsDbBacked: projectId = proj.id のみ、guard あり
- [x] okr/updateProjectOKRDb: projectId = proj.id のみ、guard あり、warning log あり
- [x] okr/addProjectOKR: projectId = proj.id のみ、guard あり
- [x] execution/dbOkrMap: 'no-project' fallback 廃止、skip logic あり
- [x] execution/lookup: 'no-project' fallback 廃止、proj.id check あり

---

## 修正による影響

### ポジティブ
- ✅ undefined のままで DB save される経路が完全に閉鎖
- ✅ STAGE5 comment save が proj.id で確実に lookup 成功
- ✅ mapHit = false の理由が明示的に logging
- ✅ 既存データの旧形式が移行ログで追跡可能

### ネガティブ
- ⚠️  proj.id missing のプロジェクトは保存できない（意図的）
- ⚠️  旧形式 OKR は初回アクセス時に project_id が上書きされる

### リスク軽減
- ✅ guard による save skip で data corruption を防止
- ✅ warning/error log で問題を可視化
- ✅ migration 段階的に実施可能

---

## 次のステップ

### Phase 2（推奨）
1. 既存データ backfill
   - project_id = "no-project" の削除
   - project_id = title のOKR の正規化

2. UI警告
   - proj.id missing プロジェクトへの明示的な警告表示
   - migration progress indicator

### Phase 3（将来）
1. Database schema
   - project_id を UUID type に変更（TEXT→UUIDへ）
   - NOT NULL constraint の強制

2. 完全な新形式への統一
   - Migration script の実行
   - Legacy format のサポート廃止

---

## 修正実装日時

- **実装開始**: 2026-04-06
- **実装完了**: 2026-04-06
- **修正ファイル数**: 3（cascade, okr, execution）
- **修正箇所数**: 5（toProjectFromDraft×1, ensureMainOkrIsDbBacked×1, updateProjectOKRDb×1, addProjectOKR×1, dbOkrMap×1, lookup×1）

