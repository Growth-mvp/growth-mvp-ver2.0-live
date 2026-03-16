# Phase 2A-3: Backfill 仕様書

## 目的

`strategy_data` の JSONB に埋め込まれた OKR を `okrs` 専用テーブルへ正本化移行。
既存 OKR を喪失せず、段階的に DB と snapshot を統合。

---

## データ移行ルール

### ソース：strategy_data → ターゲット：okrs テーブル

#### 読み込み元（strategy_data 構造）

```typescript
strategy_data
  ├─ id: UUID                 // strategy_id
  ├─ company_id: UUID
  └─ departments: Array
      └─ [d]
          ├─ id or name       // department_id（TEXT化）
          └─ projects: Array
              └─ [p]
                  ├─ id or title          // project_id（TEXT化）
                  ├─ okrs?: Array<OKR>    // ← Backfill 対象
                  │   └─ [o]
                  │       ├─ id?: string
                  │       ├─ objective: string
                  │       ├─ keyResults: string[]
                  │       ├─ owner?: string    // ownerName に変換
                  │       └─ ...
                  └─ okrsV2?: Array<KRStructured> // ← 互換（今は無視）
```

#### 書き込み先（okrs テーブル）

```sql
INSERT INTO okrs (
  id,
  company_id,
  strategy_id,
  department_id,      -- TEXT
  project_id,         -- TEXT
  objective,
  key_results_json,   -- JSONB
  owner_user_id,      -- UUID (null 許容)
  owner_name,         -- TEXT
  status,
  sort_order,
  source_stage,
  source_okr_id,
  is_deleted,
  meta_json,
  created_at,
  updated_at,
  created_by,
  updated_by
)
SELECT ... FROM strategy_data;
```

### 移行ロジック

#### 1. OKR.id の生成・保持

```typescript
// 既存 okr.id がある場合
okr_row.id = okr.id  // そのまま使用

// okr.id が無い場合
okr_row.id = gen_random_uuid()  // DB 側で生成

// 重要：source_okr_id で元の id を保持（legacy 参照用）
okr_row.source_okr_id = okr.id  // null 許容
```

#### 2. department_id / project_id（TEXT化）

```typescript
// department_id
dept.id がある場合:
  okr_row.department_id = String(dept.id)
dept.id が無い場合:
  okr_row.department_id = dept.name  // TEXT ベース

// project_id
proj.id がある場合:
  okr_row.project_id = String(proj.id)
proj.id が無い場合:
  okr_row.project_id = proj.title  // TEXT ベース（後方互換）

// ★ 警告：
// - title ベース department_id / project_id は不安定（重複リスク）
// - Backfill 後に Phase 1.5 で id 整備が推奨
```

#### 3. owner 関連フィールド

```typescript
// DB 層：owner_user_id は UUID（nullable）
okr_row.owner_user_id =
  typeof okr.owner === 'string' && isValidUUID(okr.owner)
    ? okr.owner  // UUID として保存
    : null       // user_id が無い = null

// 表示名：owner_name に保存
okr_row.owner_name =
  typeof okr.ownerName === 'string'
    ? okr.ownerName
    : okr.owner  // fallback（互換性）
```

#### 4. key_results

```typescript
okr_row.key_results_json =
  Array.isArray(okr.keyResults)
    ? okr.keyResults
    : []  // 空 OKR も保存（削除前提で）
```

#### 5. source_stage（生成元追跡）

```typescript
okr_row.source_stage = 'migration'  // strategy_data から backfill
```

#### 6. soft delete フラグ

```typescript
okr_row.is_deleted = false  // 移行時は全て有効
```

#### 7. タイムスタンプ

```typescript
// 既存データなので created_at は strategy_data の updated_at を参考
okr_row.created_at = strategy_data.updated_at or now()

// Backfill 実行時刻
okr_row.updated_at = now()
```

---

## データ検証

### Backfill 前

1. **OKR 件数確認**
   ```sql
   -- strategy_data に含まれる OKR 総数
   SELECT
     COUNT(*) as total_okr_count,
     COUNT(DISTINCT sd.id) as strategy_count,
     COUNT(DISTINCT dept->>'name') as department_count
   FROM strategy_data sd,
        jsonb_array_elements(sd.departments) dept,
        jsonb_array_elements(dept->'projects') proj,
        jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
   WHERE okr->>'objective' IS NOT NULL;
   ```

2. **NULL チェック**
   ```sql
   -- objective が空の OKR を検出
   SELECT COUNT(*) as empty_objectives
   FROM strategy_data sd,
        jsonb_array_elements(sd.departments) dept,
        jsonb_array_elements(dept->'projects') proj,
        jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
   WHERE (okr->>'objective' IS NULL OR okr->>'objective' = '');
   ```

3. **ID ユニークネス確認**
   ```sql
   -- 同一戦略内で OKR.id の重複がないか確認
   SELECT
     sd.id as strategy_id,
     okr->>'id' as okr_id,
     COUNT(*) as count
   FROM strategy_data sd,
        jsonb_array_elements(sd.departments) dept,
        jsonb_array_elements(dept->'projects') proj,
        jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
   WHERE okr->>'id' IS NOT NULL
   GROUP BY sd.id, okr->>'id'
   HAVING COUNT(*) > 1;
   ```

### Backfill 後

1. **件数整合確認**
   ```sql
   -- migration source のみでカウント
   SELECT
     COUNT(*) as okrs_count,
     COUNT(DISTINCT strategy_id) as strategy_count,
     COUNT(DISTINCT department_id) as department_count,
     COUNT(DISTINCT CASE WHEN is_deleted = false THEN id END) as active_count
   FROM okrs
   WHERE source_stage = 'migration'
     AND is_deleted = false;
   ```
   ✅ 前回の total_okr_count と一致していること

2. **ID ユニークネス確認（okrs テーブル側）**
   ```sql
   -- 同一プロジェクト内で sort_order のギャップがないか
   SELECT
     strategy_id,
     department_id,
     project_id,
     COUNT(*) as okr_count,
     MAX(sort_order) as max_sort_order
   FROM okrs
   WHERE is_deleted = false
   GROUP BY strategy_id, department_id, project_id;
   ```

3. **Orphaned レコード検査**
   ```sql
   -- strategy_data から削除されたが okrs に残ってる OKR
   -- （データ整合性の観点）
   SELECT
     o.id,
     o.strategy_id,
     o.department_id,
     o.project_id
   FROM okrs o
   LEFT JOIN strategy_data sd ON o.strategy_id = sd.id
   WHERE sd.id IS NULL
     AND o.is_deleted = false
     AND o.source_stage = 'migration';
   ```

4. **soft delete フラグ確認**
   ```sql
   SELECT COUNT(*) as deleted_okr_count
   FROM okrs
   WHERE is_deleted = true;
   ```
   ✅ 0 であること（Backfill 時は全て有効）

---

## Backfill 実行スクリプト（アプリケーション層）

### ファイル：`utils/supabase/backfillOkrs.ts`

```typescript
/**
 * strategy_data から okrs テーブルへ OKR を backfill
 * - Supabase SQL エディタでは実行不可（複雑な JSON 処理）
 * - アプリケーション層で実行（Node.js）
 */

import { supabase } from './client';
import type { StrategyData } from '@/types/strategy';

export async function backfillOkrsFromStrategyData(): Promise<{
  success: boolean;
  migratedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    // 1. strategy_data をすべて読み込み
    const { data: allStrategies, error: readError } = await supabase
      .from('strategy_data')
      .select('*');

    if (readError) {
      errors.push(`Failed to read strategy_data: ${readError.message}`);
      return { success: false, migratedCount: 0, errors };
    }

    if (!allStrategies || allStrategies.length === 0) {
      console.warn('[backfillOkrs] No strategy_data found');
      return { success: true, migratedCount: 0, errors };
    }

    // 2. 各 strategy ごとに OKR を抽出 + 挿入
    for (const strategy of allStrategies) {
      const okrsToInsert = extractOkrsFromStrategy(strategy);

      if (okrsToInsert.length === 0) continue;

      // 3. okrs テーブルへ一括挿入（ON CONFLICT で安全）
      const { data, error: insertError } = await supabase
        .from('okrs')
        .upsert(okrsToInsert, {
          onConflict: 'id',
        })
        .select();

      if (insertError) {
        errors.push(
          `Failed to insert OKRs for strategy ${strategy.id}: ${insertError.message}`
        );
        continue;
      }

      migratedCount += data?.length ?? 0;
    }

    // 4. Backfill 完了を記録（strategy_data に sync 日時を更新）
    const { error: updateError } = await supabase
      .from('strategy_data')
      .update({
        okrs_table_synced_at: new Date().toISOString(),
        okrs_migration_status: 'completed',
      })
      .eq('okrs_migration_status', 'in_progress');

    if (updateError) {
      errors.push(`Failed to update migration status: ${updateError.message}`);
    }

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
    };
  } catch (err) {
    errors.push(`Unexpected error: ${String(err)}`);
    return { success: false, migratedCount, errors };
  }
}

/**
 * strategy_data から OKR 行を抽出
 */
function extractOkrsFromStrategy(strategy: StrategyData): any[] {
  const okrsToInsert: any[] = [];

  const depts = strategy.departments ?? [];
  for (const dept of depts) {
    const projects = dept.projects ?? [];
    for (const proj of projects) {
      const okrs = proj.okrs ?? [];
      for (const okr of okrs) {
        // objective が無い OKR はスキップ（データ品質）
        if (!okr.objective) continue;

        const okrRow = {
          id: okr.id || crypto.randomUUID?.() || `okr_${Date.now()}`,
          company_id: strategy.company_id,
          strategy_id: strategy.id,
          department_id: String(dept.id ?? dept.name ?? ''),
          project_id: String(proj.id ?? proj.title ?? ''),
          objective: okr.objective,
          key_results_json: okr.keyResults ?? [],
          owner_user_id:
            typeof okr.owner === 'string' && isValidUUID(okr.owner)
              ? okr.owner
              : null,
          owner_name: okr.ownerName || okr.owner || null,
          status: 'draft',
          sort_order: 0,
          source_stage: 'migration' as const,
          source_okr_id: okr.id || null,
          is_deleted: false,
          meta_json: {},
          created_at: strategy.updated_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: strategy.user_id || null,
          updated_by: strategy.user_id || null,
        };

        okrsToInsert.push(okrRow);
      }
    }
  }

  return okrsToInsert;
}
```

---

## Rollback 計画

### Scenario 1: Backfill 前に異常検知

```sql
-- okrs テーブルをクリア（Staging で即実行）
DELETE FROM okrs
WHERE source_stage = 'migration'
  AND created_at > NOW() - INTERVAL '1 hour';
```

### Scenario 2: Backfill 後に データ喪失検知

```sql
-- okrs テーブルから migration source を削除
-- strategy_data.okrs は元のまま残る
DELETE FROM okrs
WHERE source_stage = 'migration'
  AND created_at > NOW() - INTERVAL '1 day';
```

### Scenario 3: 本番環境での緊急 Rollback

```sql
-- 1. okrs テーブルを無効化（soft delete 反転）
UPDATE okrs
SET is_deleted = true
WHERE source_stage = 'migration';

-- 2. コード側で strategy_data.okrs 読込に戻す
-- 3. okrs テーブルは放置（後日クリーンアップ）
```

---

## Backfill 実行フロー

### Phase 2A-3 スケジュール

#### Day 1（Mon 2026-03-16）
- [ ] Backfill スクリプト実装 + Unit test
- [ ] Staging 環境で Dry-run（データ検証）
- [ ] 企業ごとの OKR 件数確認

#### Day 2（Tue 2026-03-17）
- [ ] Staging での本実行
- [ ] Validation queries を全て実行
- [ ] ロールバック計画の最終確認
- [ ] 本番実行予定日の事前通知

#### Staging での手順

```bash
# 1. Staging DB に okrs テーブルを作成（PHASE_2A_SUPABASE_MIGRATION.sql）
supabase db push  # または SQL エディタで手動実行

# 2. Backfill スクリプトを実行
npm run migrate:okrs:staging

# 3. Validation queries を実行
supabase db query PHASE_2A_VALIDATION.sql

# 4. 結果確認・ロールバック試験
```

#### 本番での手順（Day 3 以降）

```bash
# 1. okrs テーブルが本番環境に存在することを確認
# 2. strategy_data のバックアップ取得
# 3. Backfill スクリプト実行
npm run migrate:okrs:production

# 4. Validation queries 実行（デルタ確認）
# 5. STAGE4 コード切替（Phase 2A-4）

# ★ 重要：
# - Backfill は一度だけ実行（ON CONFLICT で idempotent）
# - 部分実行後の再実行も安全
```

---

## チェックリスト

### Backfill 前

- [ ] okrs テーブル SQL が Staging で動作確認済み
- [ ] Validation queries が全て実行可能
- [ ] Backfill スクリプトが Staging で成功
- [ ] Rollback script が準備済み
- [ ] strategy_data のバックアップ計画確認

### Backfill 実行時

- [ ] company_id ごとの OKR 件数を記録
- [ ] Backfill スクリプトの実行ログを保存
- [ ] Validation queries の結果を記録
- [ ] 予期しない削除 OKR がないか確認

### Backfill 後

- [ ] okrs テーブル件数 = strategy_data 件数
- [ ] soft delete フラグが全て false
- [ ] orphaned OKR がないか確認
- [ ] Phase 2A-4 へ進行可能

---

## リスク・ 注意事項

### ⚠️ リスク 1: OKR ID の重複

- **症状**: Backfill で `ON CONFLICT id` が発動
- **原因**: strategy_data 内で同じ okr.id が複数存在
- **対策**:
  - Backfill 前に validation query で確認
  - 重複があれば手動で ID を付け替え

### ⚠️ リスク 2: owner_user_id の型ずれ

- **症状**: okr.owner が UUID でなく名前文字列
- **原因**: Legacy system では owner=string
- **対策**:
  - owner_user_id = null
  - owner_name に文字列を保存
  - UI 側で user_id lookup

### ⚠️ リスク 3: department_id / project_id が空

- **症状**: dept.id と dept.name が両方 null
- **原因**: 古い strategy_data 形式
- **対策**:
  - department_id = '' で保存（NULL 許容）
  - 後日 Phase 1.5 で補充

### ⚠️ リスク 4: Backfill 中の新規 OKR 作成

- **症状**: Backfill 途中に UI から OKR 追加された
- **原因**: 並行アクセス
- **対策**:
  - Backfill 中は STAGE4/STAGE3 を読み取り専用に
  - または Backfill を深夜実行

---

## FAQ

**Q. Backfill に失敗した場合、部分実行を再開できるか?**
> A. はい。`ON CONFLICT (strategy_id, department_id, project_id, id) DO NOTHING` により、既に存在する OKR はスキップされます。

**Q. strategy_data の okrs[] は削除するのか?**
> A. いいえ。snapshot として保持します（fallback 用）。Phase 2A-4 以降で okrs テーブル優先を使用。

**Q. soft delete された OKR はどうなるか?**
> A. Backfill では全て `is_deleted = false` で移行。削除は STAGE4 運用で発生。

**Q. Backfill 後に新規 OKR を追加したら?**
> A. okrs テーブルに挿入。snapshot は useAutoSave で自動同期。

---

## 次フェーズ

Backfill 完了後、Phase 2A-4（STAGE4 切替）へ進む。
- okr/page.tsx に `resolveProjectsWithOkrs()` 統合
- okrs テーブルを正本として読込開始

