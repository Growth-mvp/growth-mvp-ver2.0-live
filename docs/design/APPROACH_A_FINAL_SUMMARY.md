# Approach A 実装完了サマリー

## 実装概要

**根本原因**: STAGE5（execution）でのdbOkrId lookup失敗
- cascade → okr → execution で projectId の値が不整合
- STAGE4で `proj.title` fallback使用 → DB保存時にtitle文字列
- STAGE5で `'no-project'` fallback使用 → lookup key不一致 → mapHit=false

**修正方針**: Approach A strict + Conservative update
- cascade: 全プロジェクトに stable ID（`proj-xxxx`）を付与
- okr/page: proj.id を正本、fallback廃止
- execution: 'no-project' fallback廃止

---

## 修正完了ファイル（全5箇所）

### 1. ✅ /app/cascade/page.tsx

**関数**: toProjectFromDraft() (Lines 2181-2197)

**修正内容**:
```typescript
// Before: return { title, reason, hypothesis, okrs: [] } as Project;  // NO id

// After:
const projectId = (d as any).id || genIdByTitle(title, undefined);
const p: Project = { ... } as any as Project & { id?: string };
(p as any).id = projectId;
return p;
```

**効果**: toLanesProjects() 経由のすべてのプロジェクトが常に proj.id を持つ

---

### 2. ✅ /app/okr/page.tsx - 修正1

**関数**: ensureMainOkrIsDbBacked() (Line 1039)

**修正内容**:
```typescript
// Before: const projectId = String(proj?.id ?? proj?.title ?? '');
// After:
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)', {...});
  return null;  // save skip
}
```

**モード**: Strict（新規OKRは必ず proj.id で保存）

---

### 3. ✅ /app/okr/page.tsx - 修正2

**関数**: updateProjectOKRDb() (Lines 1108-1131)

**修正内容**:
```typescript
// Before: const projectId = String(proj?.id ?? proj?.title ?? targetOkr.id ?? '');
// After:
const projectId = String(proj?.id ?? '');
if (!projectId) {
  console.error('[updateProjectOKRDb] proj.id missing (data integrity issue)', {...});
  return;  // save skip
}
if (targetOkr?.project_id && targetOkr.project_id !== projectId) {
  console.warn('[updateProjectOKRDb] project_id mismatch (migrating to new format)', {...});
  // 新形式で上書き
}
```

**モード**: Conservative（既存OKRを新形式に段階的に統一、警告ログ付き）

---

### 4. ✅ /app/okr/page.tsx - 修正3

**関数**: addProjectOKR() (Lines 1292-1305)

**修正内容**:
```typescript
// Before: const projectId = proj ? String((proj as any).id ?? proj.title) : '';
// After:
const projectId = proj ? String((proj as any).id ?? '') : '';
if (!projectId) {
  console.error('[addProjectOKR] proj.id missing (data integrity issue)', {...});
  alert('プロジェクト情報が取得できません');
  return;  // save skip
}
```

**モード**: Strict（新規OKRは必ず proj.id で保存）

---

### 5. ✅ /app/execution/page.tsx - 修正1

**関数**: dbOkrMap 構築 (Lines 1691-1718)

**修正内容**:
```typescript
// Before: const projectId = okr.project_id || 'no-project';
// After:
data.forEach((okr: any) => {
  if (!okr.project_id) {
    console.warn('[STAGE5-dbOkrMap] okr.project_id missing (data corruption)', {...});
    return;  // skip
  }
  if (!okr.project_id.startsWith('proj-')) {
    console.info('[STAGE5-dbOkrMap] okr using legacy project_id format', {...});
  }
  const key = `${scopeCompanyId}::${scopeStrategyId}::${okr.project_id}::...`;
  map[key] = okr.id;
});
```

**変更**: 'no-project' fallback廃止、invalid entryはskip、旧形式サポート（ログ付き）

---

### 6. ✅ /app/execution/page.tsx - 修正2

**関数**: dbOkrId lookup (Lines 1874-1888)

**修正内容**:
```typescript
// Before: const projectIdForKey = resolvedProjId || 'no-project';
// After:
if (!resolvedProjId) {
  console.warn('[STAGE5-lookup] proj.id missing (expected from Approach A)', {...});
  dbOkrId = undefined;
  mapHit = false;
} else {
  const lookupKey = `${scopeCompanyId}::${scopeStrategyId}::${resolvedProjId}::...`;
  dbOkrId = dbOkrMap[lookupKey];
  mapHit = !!dbOkrId;
}
```

**変更**: 'no-project' fallback廃止、proj.id必須化、lookup misを明示

---

## 修正条件への対応

### 1. projectId 一致性 ✅

| 段階 | 箇所 | 修正前 | 修正後 |
|-----|------|------|------|
| STAGE3 | cascade/toProjectFromDraft | ID なし | `genIdByTitle()` で生成 |
| STAGE4 | okr/ensureMainOkrIsDbBacked | `proj.id ?? proj.title ?? ''` | `proj.id ?? ''` |
| STAGE4 | okr/updateProjectOKRDb | `proj.id ?? proj.title ?? targetOkr.id ?? ''` | `proj.id ?? ''` |
| STAGE4 | okr/addProjectOKR | `proj?.id ?? proj.title` | `proj?.id ?? ''` |
| STAGE5 | execution/dbOkrMap | `okr.project_id \|\| 'no-project'` | `okr.project_id` (skip if missing) |
| STAGE5 | execution/lookup | `resolvedProjId \|\| 'no-project'` | `resolvedProjId` (guard) |

### 2. Fallback戦略 ✅

**廃止した fallback**:
- ❌ proj.title （okr/page の3箇所）
- ❌ 'no-project' （execution/page の2箇所）
- ❌ targetOkr.id （okr/updateProjectOKRDb）

**残した fallback**:
- ✅ dept.name for dept.id （okr/page では必要、projectId問題とは無関）

### 3. undefined 流出防止 ✅

**Guard 追加箇所**:
- ensureMainOkrIsDbBacked: `if (!projectId) return null;` (Line 1042-1053)
- updateProjectOKRDb: `if (!projectId) return;` (Line 1112-1122)
- addProjectOKR: `if (!projectId) alert + return;` (Line 1295-1305)
- dbOkrMap: `if (!okr.project_id) return;` (Line 1697-1704)
- dbOkrId lookup: `if (!resolvedProjId) dbOkrId = undefined; mapHit = false;` (Line 1874-1883)

### 4. execution との整合 ✅

**修正前**:
- okr/page: proj.title で保存 → DB: project_id = "Learning Program"
- execution: 'no-project' で lookup → key mismatch

**修正後**:
- okr/page: proj.id で保存 → DB: project_id = "proj-a1b2c3"
- execution: proj.id で lookup → key match ✓

---

## 既存データ互換性

### パス1: 新規 OKR（修正後）
```
cascade: proj.id = "proj-xxxx" ✓
okr: projectId = proj.id ✓
DB: project_id = "proj-xxxx" ✓
execution: lookup key match ✓
```

### パス2: 既存 OKR（旧形式）
```
DB: project_id = "Learning Program" （旧format）
okr/updateProjectOKRDb: warning log + proj.id で上書き
DB: project_id = "proj-xxxx" （migrated）
execution: lookup key match ✓
```

### パス3: Broken 状態（修正により検出）
```
DB: project_id = "no-project"
execution/dbOkrMap: skip + warn log
execution/lookup: mapHit = false + warn log
okr再編集時: 新形式で修復
```

---

## ログ出力仕様

### Error Level（save skip）
```
[ensureMainOkrIsDbBacked] missing identifiers (proj.id must exist per Approach A)
[updateProjectOKRDb] proj.id missing (data integrity issue)
[addProjectOKR] proj.id missing (data integrity issue)
```

### Warning Level（問題検出）
```
[STAGE5-dbOkrMap] okr.project_id missing (data corruption)
[updateProjectOKRDb] project_id mismatch (migrating to new format)
[STAGE5-lookup] proj.id missing (expected from Approach A)
```

### Info Level（統計情報）
```
[STAGE5-dbOkrMap] okr using legacy project_id format
```

---

## 修正による影響

### ✅ 解決される問題
- STAGE5 comment save が projectId mismatch で失敗する issue
- undefined のまま DB に保存される経路の完全閉鎖
- mapHit = false の原因が明示的になる

### ⚠️  考慮すべき事項
- proj.id がないプロジェクトは OKR を保存できない（意図的）
- 旧形式 OKR は初回 STAGE4 アクセス時に project_id が上書きされる
- 既存データは段階的に新形式に移行

### ✅ リスク軽減
- Guard により save skip で data corruption を防止
- Warning/Error log で問題を可視化
- Info log で migration 状況を追跡可能

---

## テスト シナリオ

### テスト1: 新規 OKR（Approach A 後）
```
1. STAGE3: プロジェクト生成（proj.id = "proj-xxxx" ✓）
2. STAGE4: ensureMainOkrIsDbBacked
   - projectId = proj.id ✓
   - save → DB: project_id = "proj-xxxx" ✓
3. STAGE5: dbOkrId lookup
   - lookupKey = "...::proj-xxxx::objective" ✓
   - dbOkrMap[key] → okr.id ✓
   - dbOkrId = okr.id, mapHit = true ✓
4. Comment save → Success ✓
```

### テスト2: 既存 OKR 更新（旧形式→新形式）
```
1. DB: okr.project_id = "Learning Program" （旧format）
2. STAGE4: updateProjectOKRDb
   - projectId = proj.id = "proj-xxxx" （新format）
   - console.warn('[updateProjectOKRDb] project_id mismatch...')
   - save → DB: project_id = "proj-xxxx" （migrated）
3. STAGE5: dbOkrId lookup
   - lookupKey = "...::proj-xxxx::objective" ✓
   - dbOkrMap[key] → okr.id ✓
   - mapHit = true ✓
```

### テスト3: proj.id missing（エラーケース）
```
1. cascade: proj.id = undefined （異常）
2. STAGE4: ensureMainOkrIsDbBacked
   - projectId = undefined
   - console.error('[ensureMainOkrIsDbBacked] missing identifiers...')
   - return null （save skip）
3. STAGE5: lookup skip
   - resolvedProjId = undefined
   - console.warn('[STAGE5-lookup] proj.id missing...')
   - dbOkrId = undefined, mapHit = false
```

---

## 次のアクション

### 即時（推奨）
- [ ] ローカル環境でテスト実行（新規OKR, 既存OKR更新）
- [ ] console ログで警告/エラーが出ることを確認
- [ ] STAGE5 comment save が成功することを確認

### Phase 2（近期）
- [ ] 既存データの旧形式 OKR が自動的に新形式に移行されることを確認
- [ ] Migration log で統計情報を取得

### Phase 3（将来）
- [ ] Migration script で一括修復
- [ ] project_id を UUID type に変更
- [ ] Legacy format サポート廃止

---

## 修正ファイル一覧

| ファイル | 修正箇所 | 行番号 | 内容 |
|---------|--------|-------|------|
| cascade/page.tsx | toProjectFromDraft | 2181-2197 | ID生成追加 |
| okr/page.tsx | ensureMainOkrIsDbBacked | 1039-1053 | Strict mode |
| okr/page.tsx | updateProjectOKRDb | 1108-1131 | Conservative + warning |
| okr/page.tsx | addProjectOKR | 1292-1305 | Strict mode |
| execution/page.tsx | dbOkrMap construction | 1691-1718 | 'no-project' fallback廃止 |
| execution/page.tsx | dbOkrId lookup | 1874-1888 | 'no-project' fallback廃止 |

---

## 実装完了チェックリスト

- [x] cascade/toProjectFromDraft: 常に project.id を返す
- [x] okr/ensureMainOkrIsDbBacked: projectId = proj.id のみ、guard あり
- [x] okr/updateProjectOKRDb: projectId = proj.id のみ、guard あり、warning log あり
- [x] okr/addProjectOKR: projectId = proj.id のみ、guard あり
- [x] execution/dbOkrMap: 'no-project' fallback 廃止、skip logic あり、migration log あり
- [x] execution/lookup: 'no-project' fallback 廃止、proj.id check あり
- [x] TypeScript エラー修正（okr: any）

---

## 修正完了日

- **開始**: 2026-04-06 / 修正1 cascade/toProjectFromDraft
- **完了**: 2026-04-06 / 修正6 execution/lookup

**合計修正**: 6箇所、3ファイル

