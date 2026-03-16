# Phase 2A-3: Backfill 実装前の確認事項

## 1. strategy_data → okrs マッピング表（完全版）

| strategy_data フィールド | okrs テーブル | 型変換 | 注記 |
|-------------------------|---------------|--------|------|
| `id` | `strategy_id` | UUID → UUID | そのまま |
| `company_id` | `company_id` | UUID → UUID | RLS スコープ |
| `departments[d].id` | `department_id` | number/string → TEXT | **必須（id がない場合は SKIP）** |
| `projects[p].id` | `project_id` | number/string → TEXT | **必須（id がない場合は SKIP）** |
| `okrs[o].id` | `id` | string → UUID | **決定的生成（hash-based）** |
| `okrs[o].id` | `source_okr_id` | string → TEXT | legacy 参照用（backfill 追跡） |
| `okrs[o].objective` | `objective` | string → TEXT | **必須（NULL は Skip）** |
| `okrs[o].keyResults` | `key_results_json` | string[] → JSONB | 空配列デフォルト |
| `okrs[o].owner` (UUID) | `owner_user_id` | string → UUID | UUID の場合のみ（isValidUUID） |
| `okrs[o].owner` (string) | `owner_user_id` | N/A | NULL に設定 |
| `okrs[o].ownerName` | `owner_name` | string → TEXT | ownerName または owner fallback |
| （なし） | `status` | N/A | `'draft'` 固定 |
| （配列インデックス） | `sort_order` | number → INTEGER | **採番ルール参照** |
| （なし） | `source_stage` | N/A | `'migration'` 固定 |
| （なし） | `is_deleted` | N/A | `false` 固定 |
| `updated_at` | `created_at` | TIMESTAMP | strategy_data の更新日時 |
| （なし） | `updated_at` | N/A | Backfill 実行時刻（now()） |
| `user_id` | `created_by` | UUID → UUID | strategy_data のユーザー |
| `user_id` | `updated_by` | UUID → UUID | strategy_data のユーザー |
| （なし） | `meta_json` | N/A | `{}` 空object |

### 🔴 **WARNING: okrsV2 は対象外**
- `projects[p].okrsV2` は Backfill **対象外**
- Phase 2A では `projects[p].okrs[]` のみを移行
- okrsV2 は後続フェーズで KR テーブル化予定
- mainOKR も存在する場合は今のところ無視

---

## 2. Idempotent 条件（重複排除）

### 一意性キー
```sql
UNIQUE(strategy_id, department_id, project_id, id) WHERE is_deleted = false
```

### ON CONFLICT 戦略
```sql
INSERT INTO okrs (...)
VALUES (...)
ON CONFLICT (strategy_id, department_id, project_id, id)
DO NOTHING;
```

### 冪等性の実装方針（修正）

#### okr.id が存在する場合
```sql
okr_row.id = okr.id  -- そのまま使用
```

#### okr.id が null / undefined の場合（決定的生成）
```typescript
// ★ 重要：random UUID ではなく、決定的 hash から UUID5 を生成
// 何度実行しても同じ ID になる（idempotent）

const seed = `${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}`;
okr_row.id = generateUUID5(NAMESPACE, seed);  // UUID v5（namespace + seed）

// または、crypto.subtle.digest を使った hash
const hashInput = seed;  // UTF-8
const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
okr_row.id = uuidFromHash(hashBytes);  // hash の先頭 16 bytes を UUID として解釈
```

### 冪等性の意味
- **okr.id 有無に関わらず、決定的に ID を生成**
- **同じ (strategy_id, department_id, project_id, objective, sort_order) → 同じ id**
- **部分実行後の再実行** → 既存行の id は変わらない
- **複数実行** → ON CONFLICT で既存行スキップ、新規行のみ挿入

### ⚠️ 重複判定の危険性 - **禁止パターン**
```typescript
// ❌ 禁止パターン 1: project_id を title で生成
okr_row.project_id = proj.title;  // ← 禁止
// 理由：同じ title の別 project 2 つが同一 project_id になる

// ✅ 対策：project.id が必須
if (!proj.id) {
  // SKIP：project has no id
  // → validation report に記録
  continue;
}
okr_row.project_id = String(proj.id);  // OK

// ❌ 禁止パターン 2: department_id を name で生成
okr_row.department_id = dept.name;  // ← 禁止
// 理由：同じ name の別 department 2 つが同一 department_id になる

// ✅ 対策：department.id が必須
if (!dept.id) {
  // SKIP：department has no id
  // → validation report に記録
  continue;
}
okr_row.department_id = String(dept.id);  // OK
```

---

## 3. Validation Queries（実行順序）

### 3.1 Backfill 前（strategy_data の OKR 件数確認）

```sql
-- Query A: Backfill 対象の OKR 件数
--         （department.id と project.id があるもののみ）
SELECT
  COUNT(*) as backfill_okr_count,
  COUNT(DISTINCT sd.id) as strategy_count,
  COUNT(DISTINCT (dept->>'id')) as department_with_id_count,
  COUNT(DISTINCT (proj->>'id')) as project_with_id_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE sd.company_id IS NOT NULL
  AND okr->>'objective' IS NOT NULL
  AND (dept->>'id') IS NOT NULL              -- ★ department.id 必須
  AND (proj->>'id') IS NOT NULL;             -- ★ project.id 必須

-- 期待値: {backfill_okr_count: N, ...}
-- → これが Backfill 後の okrs テーブル件数と一致するはず
```

```sql
-- Query A2: Skip される OKR 件数（department.id or project.id がない）
SELECT
  COUNT(*) as skipped_okr_count,
  SUM(CASE WHEN (dept->>'id') IS NULL THEN 1 ELSE 0 END) as no_department_id,
  SUM(CASE WHEN (proj->>'id') IS NULL THEN 1 ELSE 0 END) as no_project_id
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE sd.company_id IS NOT NULL
  AND okr->>'objective' IS NOT NULL
  AND ((dept->>'id') IS NULL OR (proj->>'id') IS NULL);

-- 期待値: skip 件数は事前把握（報告対象）
-- → ユーザーは Phase 1.5 で id 整備を検討
```

```sql
-- Query B: NULL objective チェック（Skip 対象）
SELECT
  COUNT(*) as null_objective_count,
  COUNT(*) as will_be_skipped
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE (okr->>'objective' IS NULL OR okr->>'objective' = '');

-- 期待値: {null_objective_count: X, will_be_skipped: X}
-- → Backfill 後の okrs テーブルにはこれらが含まれない
```

```sql
-- Query B2: okrsV2 のみ存在するプロジェクト（okrs[] は空）
--          ★ これらは Backfill されない（自動移行なし）
SELECT
  sd.id as strategy_id,
  dept->>'id' as department_id,
  proj->>'id' as project_id,
  proj->>'title' as project_title,
  CASE
    WHEN jsonb_array_length(COALESCE(proj->'okrs', '[]'::jsonb)) > 0 THEN 'has_okrs'
    ELSE 'no_okrs'
  END as okrs_status,
  CASE
    WHEN jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb)) > 0 THEN 'has_okrsV2'
    ELSE 'no_okrsV2'
  END as okrsV2_status,
  jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb)) as okrsV2_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj
WHERE (proj->>'id') IS NOT NULL
  AND jsonb_array_length(COALESCE(proj->'okrs', '[]'::jsonb)) = 0
  AND jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb)) > 0;

-- 期待値: okrsV2-only プロジェクトの件数（報告対象）
-- → Phase 2C で KR テーブル化予定のため、今回は自動移行しない
```

```sql
-- Query C: ID 重複検査（okr.id が有るもの）
--         同一プロジェクト内での重複は ON CONFLICT で処理
SELECT
  sd.id as strategy_id,
  (dept->>'id') as department_id,
  (proj->>'id') as project_id,
  okr->>'id' as okr_id,
  COUNT(*) as duplicate_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE okr->>'id' IS NOT NULL
  AND (dept->>'id') IS NOT NULL
  AND (proj->>'id') IS NOT NULL
GROUP BY sd.id, (dept->>'id'), (proj->>'id'), okr->>'id'
HAVING COUNT(*) > 1;

-- 期待値: 結果は 0 行（重複なし）
-- → 同一プロジェクト内で同じ okr.id が 2 度現れることはあり得ない
```

### 3.2 Backfill 後（okrs テーブルの整合確認）

```sql
-- Query D: okrs テーブル件数（Backfill 成功確認）
SELECT
  COUNT(*) as migrated_okr_count,
  COUNT(DISTINCT strategy_id) as strategy_count,
  COUNT(DISTINCT department_id) as department_with_okr_count,
  COUNT(DISTINCT project_id) as project_with_okr_count,
  COUNT(DISTINCT CASE WHEN is_deleted = false THEN id END) as active_okr_count
FROM okrs
WHERE source_stage = 'migration'
  AND is_deleted = false;

-- 期待値: Query A の backfill_okr_count と **完全一致**
-- → 不一致 = 喪失のリスク → Rollback
```

```sql
-- Query E: Soft delete フラグ確認（全て is_deleted = false）
SELECT COUNT(*) as deleted_okr_count
FROM okrs
WHERE source_stage = 'migration'
  AND is_deleted = true;

-- 期待値: 0 行
-- → Backfill では全て is_deleted = false で移行
```

```sql
-- Query F: Orphaned OKR 検査（strategy_data に対応がない）
SELECT
  o.id,
  o.strategy_id,
  o.department_id,
  o.project_id,
  o.objective
FROM okrs o
LEFT JOIN strategy_data sd ON o.strategy_id = sd.id
WHERE o.source_stage = 'migration'
  AND o.is_deleted = false
  AND sd.id IS NULL;

-- 期待値: 0 行
-- → strategy_data から削除されたが okrs に残ってる OKR がないか確認
```

```sql
-- Query G: sort_order のギャップ確認（プロジェクト単位）
SELECT
  strategy_id,
  department_id,
  project_id,
  COUNT(*) as okr_count,
  MAX(sort_order) as max_sort_order,
  MAX(sort_order) - COUNT(*) + 1 as expected_min_sort_order
FROM okrs
WHERE source_stage = 'migration'
  AND is_deleted = false
GROUP BY strategy_id, department_id, project_id;

-- 期待値:
-- - okr_count = max_sort_order + 1（0-indexed）
-- - ギャップなし
```

---

## 4. Rollback 条件（リスク判定）

### 🟢 Backfill 成功判定条件（全て必須）

```
✅ Query A total_okr_count == Query D total_okr_count
✅ Query E deleted_okr_count == 0
✅ Query F orphaned OKR == 0 行
✅ Query G max_sort_order ギャップなし
✅ okrs テーブル RLS が有効
```

### 🔴 Rollback 実行条件（いずれかが true）

```
❌ Query A と Query D の件数が異なる（喪失の可能性）
❌ okrs テーブルに is_deleted = true が存在（想定外）
❌ Orphaned OKR が存在
❌ RLS が無効または設定異常
❌ progress_logs.okr_id FK 制約エラー
```

### Rollback SQL（Staging 用）

```sql
-- 全 migration source を削除（アプリ層でのみ）
DELETE FROM okrs
WHERE source_stage = 'migration'
  AND created_at >= '2026-03-17'::date;  -- Backfill 実行日付

-- 確認
SELECT COUNT(*) as remaining_okrs FROM okrs;
```

### Rollback SQL（本番環境）

```sql
-- 削除ではなく is_deleted = true に（恢復可能性）
UPDATE okrs
SET is_deleted = true,
    updated_at = now()
WHERE source_stage = 'migration'
  AND created_at >= '2026-03-17'::date;

-- コード側で strategy_data.okrs[] 読込に戻す
-- okrs テーブルは放置（Phase 2A-4 スキップ）
```

---

## 5. Legacy Data の扱い

### 5.1 **department.id / project.id がない場合（SKIP + Report）**

```typescript
// ❌ Legacy department（id がない）
{
  name: 'Sales',
  id: null  // ← id がない
}

// ✅ Backfill 時の扱い
if (!dept.id) {
  // Skip：department has no id
  // → validation report に記録（Query A2）
  // → 当該 department 配下の全 OKR は skip
  // → ユーザーは Phase 1.5 で department.id を整備
  continue;
}

// ❌ Legacy project（id がない）
{
  title: 'Growth Sales',
  id: null  // ← id がない
}

// ✅ Backfill 時の扱い
if (!proj.id) {
  // Skip：project has no id
  // → validation report に記録（Query A2）
  // → 当該 project の全 OKR は skip
  // → ユーザーは Phase 1.5 で project.id を整備
  continue;
}
```

**理由**:
- id がない = title / name でしか識別できない
- 同一 title の複数 project が存在可能 → 誤接続リスク
- 決定的に識別できる id が必須

### 5.2 okr.id が無い場合（決定的生成）

```typescript
// Legacy OKR
okr = {
  objective: 'Increase ARR',
  keyResults: ['KR1', 'KR2'],
  id: null  // ← id が無い
}

// Backfill 時（決定的生成）
const seed = `${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}`;
okr_row.id = generateUUID5(NAMESPACE, seed);  // 決定的 UUID

okr_row.source_okr_id = null  // null 保持（元々 id がないため）

// ★ 冪等性：何度実行しても同じ id が生成される
```

### 5.3 owner が UUID でない場合

```typescript
// Legacy OKR
okr = {
  owner: 'Alice'  // → UUID でなく文字列
  ownerName: 'Alice Chen'
}

// Backfill 時
okr_row.owner_user_id = null  // user_id 不詳 → NULL
okr_row.owner_name = 'Alice Chen'  // 表示名は保存
```

### 5.4 okrsV2 / mainOKR は無視

```typescript
// Backfill の対象
project.okrs[]  // ← ここだけ対象

// 対象外（後続フェーズ）
project.okrsV2[]  // KRStructured 形式（Phase 2C で移行予定）
project.mainOKR   // メイン目標（未定義）
```

---

## 6. sort_order 採番ルール

### 採番方式

```typescript
// プロジェクト内の okrs[] 配列順序を保持
for (let i = 0; i < project.okrs.length; i++) {
  okr_row.sort_order = i;  // 0, 1, 2, ...
}
```

### 具体例

```typescript
strategy_data = {
  departments: [
    {
      name: 'Sales',
      projects: [
        {
          title: 'Growth',
          okrs: [
            { id: 'okr-001', objective: 'Increase ARR' },      // sort_order = 0
            { id: 'okr-002', objective: 'Expand customer base' },  // sort_order = 1
            { id: 'okr-003', objective: 'Improve NPS' }         // sort_order = 2
          ]
        }
      ]
    }
  ]
}

// ↓ Backfill 後
okrs テーブル:
| id     | strategy_id | department_id | project_id | sort_order |
|--------|-------------|---------------|------------|-----------|
| okr-001| ...         | Sales         | Growth     | 0         |
| okr-002| ...         | Sales         | Growth     | 1         |
| okr-003| ...         | Sales         | Growth     | 2         |
```

### Query でのソート確認

```sql
SELECT
  id, objective, sort_order
FROM okrs
WHERE strategy_id = 'xxx'
  AND department_id = 'Sales'
  AND project_id = 'Growth'
  AND is_deleted = false
ORDER BY sort_order ASC;

-- 期待値：sort_order が 0, 1, 2, ... 連続（ギャップなし）
```

---

## 7. okrs / okrsV2 / mainOKR の選定

### ✅ Backfill 対象：okrs[]

```typescript
// strategy_data の構造
{
  departments: [
    {
      id: number | string,  // ★ 必須（id なし = skip）
      projects: [
        {
          id: number | string,  // ★ 必須（id なし = skip）
          okrs: [  // ← ★ Backfill の唯一の対象
            {
              id?: string,
              objective: string,  // ★ 必須（NULL = skip）
              keyResults: string[],
              owner?: string,      // UUID or string
              ownerName?: string
            }
          ]
        }
      ]
    }
  ]
}
```

**理由**:
- OKR の基本形式（互換性が高い）
- STAGE4 で使用されている配列
- キーリザルトが string[] で簡潔
- 移行対象の明確化（他と混在しない）

### ⚠️ 監視対象：okrsV2[]（自動移行なし）

```typescript
// okrsV2 は KRStructured[] で複雑
okrsV2: [
  {
    id: UUID,
    kind: 'REVENUE' | 'CHURN' | ...,
    label: string,
    target: number,
    unit: KRUnit,
    due?: string,
    owner?: string,
    scope: 'company' | 'department' | 'project',
    baseKey: BaseKey,
    // ... 多数のフィールド
  }
]

// Phase 2A では**自動移行なし**
// ただし Query B2 で件数確認（okrs[] が空で okrsV2[] のみのプロジェクト）
```

**理由**:
- 構造が複雑（KR 個別テーブル化の準備中）
- Phase 2C で KR テーブル化を予定
- 事前に okrsV2-only プロジェクトの件数を把握したい

### ❌ 対象外：mainOKR

```typescript
// mainOKR は現在、データ定義が曖昧
project.mainOKR?: {
  objective?: string,
  // ... undefined
}

// どのフィールドが必須か不明
// → Backfill スキップ
```

**理由**:
- 型定義が明確でない
- データが疎（ほぼ undefined）
- 必要性が不確実

### Backfill ターゲットの確定

```typescript
// ✅ Phase 2A-3 Backfill の対象
if (project.id && department.id && project.okrs?.length > 0) {
  source_okrs = project.okrs;  // Array<OKR>
  // Backfill 実行
} else {
  // SKIP + report
}

// ⚠️ 監視対象（自動移行なし）
if (project.id && project.okrs?.length === 0 && project.okrsV2?.length > 0) {
  // Query B2 で件数集計
  // → ユーザーに報告
}

// ❌ 完全無視
ignored = [
  project.mainOKR,
  project.kpis  // （calculated field）
];
```

---

## 8. Company_id / RLS / progress_logs 整合

### company_id（スコープ）

```sql
-- okrs テーブル
├─ company_id (UUID NOT NULL)
│  ├─ REFERENCES auth.users(id) ON DELETE CASCADE
│  └─ PARTITION BY HASH (company_id)  ← 物理分割
├─ strategy_id (UUID)
├─ department_id (TEXT)
├─ project_id (TEXT)
└─ ...

-- strategy_data テーブル
├─ company_id (UUID)  ← ここから読み込み
├─ departments (JSONB)
└─ ...

-- Backfill 時
okrs.company_id = strategy_data.company_id  // そのまま写す
```

**RLS との統合**:
```sql
-- Policy: ユーザーの会社内 OKR のみ読取
SELECT ... FROM okrs
WHERE company_id IN (
  SELECT id FROM user_companies
  WHERE user_id = auth.uid()
)
```

### progress_logs.okr_id（FK 参照 + 保険）

```sql
-- progress_logs テーブル
├─ id (UUID PRIMARY KEY)
├─ okr_id (UUID)  ← ★ NEW（Phase 2A-4 で使用）
│  └─ REFERENCES okrs(id) ON DELETE SET NULL  ← ★ 物理delete時のみ発火
├─ okrId (TEXT)  ← レガシー（互換維持）
├─ department (TEXT)
├─ project (TEXT)
└─ ...

-- ★ 重要：ON DELETE SET NULL の発火タイミング
-- 【通常運用】okrs テーブルは soft delete（is_deleted = true）
--            → ON DELETE SET NULL は発火しない
--            → progress_logs.okr_id は有効なまま
--
-- 【物理 delete】okrs レコードが物理削除された場合
--            → ON DELETE SET NULL が発火
--            → progress_logs.okr_id = NULL に自動更新
--            → これは保険（orphaned progress_logs の防止）

-- Backfill との連携：
-- Phase 2A-3: okrs テーブル構築
-- Phase 2A-4: progress_logs.okr_id を populate（後続）
-- Phase 2A-5: progress_logs 読込を okr_id ベースに変更
```

### soft delete の整合

```sql
-- okrs テーブル（soft delete ベース）
SELECT ... FROM okrs
WHERE is_deleted = false  ← 常にこのフィルター

-- progress_logs.okr_id が参照
-- soft delete では ON DELETE SET NULL は発火しない
-- → okr_id は有効なままだが、is_deleted = true で読み取られない
-- → 論理的に「削除済み」と扱われる

-- もし物理 delete が必要な場合
DELETE FROM okrs WHERE id = 'xxx'
  → ON DELETE SET NULL が発火
  → progress_logs.okr_id = NULL
```

### 重複判定の整合

```sql
-- Uniqueness constraint
UNIQUE(strategy_id, department_id, project_id, id) WHERE is_deleted = false

-- ★ 重要：is_deleted = false のみが unique 対象
-- → 削除した OKR は同じ (strategy_id, department_id, project_id) で再作成可能
-- （soft delete ベースの設計で、重複判定を正確に）
```

---

## 9. 実装前最終チェックリスト

### DB 側の確認
- [ ] okrs テーブルが Staging に作成済み
- [ ] RLS が有効（4 policies）
- [ ] progress_logs.okr_id FK が作成済み
  - [ ] ON DELETE SET NULL（物理delete保険）
- [ ] strategy_data.okrs_migration_status 列が追加済み
- [ ] PARTITION BY HASH (company_id) が機能

### Validation 側の確認
- [ ] Query A（Backfill対象の OKR 件数）が実行可能
- [ ] Query A2（Skip される OKR 件数）が実行可能
- [ ] Query B2（okrsV2-only プロジェクト）が実行可能
- [ ] Query C（ID 重複検査）が実行可能
- [ ] Query D-G（Backfill後確認）が実行可能
- [ ] Backfill 前に Query A/A2/B2/C を実行して結果を記録

### Data 側の確認
- [ ] ✅ Backfill対象：project.okrs[]（department.id && project.id 必須）
- [ ] ✅ Skip対象：project.okrs[]（department.id or project.id がない）
- [ ] ⚠️ 監視対象：project.okrsV2[]（okrs[] が空で okrsV2[] のみ）
- [ ] ❌ 無視：project.mainOKR
- [ ] NULL objective は Skip
- [ ] ID 重複なし（Query C）

### Backfill スクリプト実装時の注意

#### 必須チェック
- [ ] `if (!department.id) { skip + report; }`
- [ ] `if (!project.id) { skip + report; }`
- [ ] `if (!okr.objective) { skip; }`

#### ID 生成（冪等性）
- [ ] okr.id が存在：そのまま使用
- [ ] okr.id が null：決定的生成（UUID5 or hash-based）
  - [ ] Seed = `${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}`
  - [ ] 何度実行しても同じ id

#### フィールド変換
- [ ] `department_id = String(department.id)`（TEXT化）
- [ ] `project_id = String(project.id)`（TEXT化）
- [ ] `owner_user_id = isValidUUID(okr.owner) ? okr.owner : null`
- [ ] `owner_name = okr.ownerName || okr.owner || null`
- [ ] `keyResults = okr.keyResults ?? []`
- [ ] `key_results_json = keyResults`（JSONB保存）

#### 固定値
- [ ] `status = 'draft'`
- [ ] `source_stage = 'migration'`
- [ ] `is_deleted = false`
- [ ] `sort_order = array_index`（0-indexed）

#### DB保存
- [ ] `company_id IS NOT NULL`（NULL チェック）
- [ ] `ON CONFLICT (strategy_id, department_id, project_id, id) DO NOTHING`
- [ ] transaction 内で実行
- [ ] Backfill 完了後に `strategy_data.okrs_migration_status = 'completed'`

---

## ✅ 実装後の期待値

```
Backfill 成功 =
  ✓ Query A == Query D（件数一致）
  ✓ Query E = 0（soft delete フラグ）
  ✓ Query F = 0（orphaned OKR）
  ✓ Query G ギャップなし（sort_order）
  ✓ strategy_data.okrs_migration_status = 'completed'
  ✓ Phase 2A-4 へ進行可能
```
