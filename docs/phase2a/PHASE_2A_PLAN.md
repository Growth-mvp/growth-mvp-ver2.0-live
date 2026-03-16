# GROWTH Phase 2A 実装計画書
## OKR正本化：strategy_data → okrsテーブル段階分離

**作成日**: 2026-03-16
**ステータス**: Phase 2A-1 分析完了、実装着手前
**対象スコープ**: OKR正本化 + 段階的移行

---

## Ⅰ. 変更対象ファイル一覧

### A. 最優先修正（コア層）

#### DB・永続化層
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 1 | `utils/supabase/strategy.ts` | OKR保存・復元 | okrs テーブルI/O層を新規作成 |
| 2 | `utils/supabase/migration.ts` (新規) | Data backfill | strategy_data → okrs テーブル移行ロジック |
| 3 | `utils/supabase/normalize.ts` | データ正規化 | ID補完ロジック追加 |

#### ストア層
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 4 | `store/strategyStore.ts` | 状態管理 | OKR読込時の okrs優先フロー追加 |

#### 型定義
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 5 | `types/strategy.ts` | 型定義 | Department/Project/OKRに id フィールド追加、OKR関連型整理 |
| 6 | `types/okrs.ts` (新規) | OKR DB型 | OkrRow, OkrWriteInput, ResolvedOkr 定義 |

#### STAGE画面
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 7 | `app/cascade/page.tsx` | STAGE3 | okrs優先+fallback読込、正本保存導線 |
| 8 | `app/okr/page.tsx` | STAGE4 | okrs正本へ完全切替（最優先） |
| 9 | `app/execution/page.tsx` | STAGE5 | okr_idベースの進捗ログ参照に統一 |
| 10 | `app/stage4/page.tsx` | 実行計画 | OKR参照を okrs正本に寄せる |

#### ロジック層
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 11 | `app/okr/_lib/okrModels.ts` | OKRモデル | ID生成ロジック整理 |
| 12 | `services/okrService.ts` (新規) | OKR業務ロジック | listOkrsByProject, upsertOkr, resolveProjectsWithOkrs など |

#### 補助
| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 13 | `app/api/debug/strategy/route.ts` | デバッグ | OKR table状態確認API追加 |

### B. 次優先修正（API・生成層）

| # | ファイル | 責務 | 修正内容 |
|---|---------|------|---------|
| 14 | `app/api/generate-cascade/route.ts` | カスケード生成 | 生成OKR → okrsテーブル対応 |
| 15 | `app/api/generate-department-draft/route.ts` | 部門ドラフト | 生成OKR → okrsテーブル対応 |
| 16 | `app/api/okr-from-exec/route.ts` | 実行計画→OKR | okrs テーブルへの反映 |

### C. その他（管理画面など、Phase 2A スコープ外）

- `app/admin/` 配下（ユーザー管理、招待等）
- `app/member/` 配下（メンバー画面）
- `app/auth/` 配下（認証フロー）

※ これらは Phase 2A では read-only のまま、修正不要

---

## Ⅱ. 追加予定ファイル一覧

| # | ファイル | 責務 | 主要関数 |
|---|---------|------|---------|
| 1 | `types/okrs.ts` | OKR DB型・UI型分離 | OkrRow, OkrWriteInput, ResolvedOkr, ProjectWithResolvedOkrs |
| 2 | `services/okrService.ts` | OKR業務ロジック層 | listOkrsByStrategy, listOkrsByProject, upsertOkr, deleteOkr, reorderOkrs, resolveProjectsWithOkrs, syncOkrsSnapshotToStrategyData |
| 3 | `utils/supabase/okrsRepository.ts` | OKR DB操作層 | OkrsRepository: query, upsert, softDelete, batchUpsert |
| 4 | `utils/supabase/migration.ts` | Data backfill | backfillOkrsTableFromStrategyData, createOkrIdsIfMissing, ensureDepartmentIds, ensureProjectIds |
| 5 | `hooks/useOkrsResolver.ts` | OKR解決フック | useResolvedOkrs(projectId): resolves okrs table + fallback |
| 6 | `PHASE_2A_PLAN.md` | ドキュメント | 実装計画書（このファイル） |
| 7 | `PHASE_2A_MIGRATION_SQL.sql` | DB migration | Supabase migration script |

---

## Ⅲ. DB Migration 案

### A. okrs テーブル新設

```sql
-- okrs テーブル新設
CREATE TABLE okrs (
  -- Primary key & relationships
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL,
  department_id TEXT NOT NULL,
  project_id TEXT NOT NULL,

  -- OKR content
  objective TEXT NOT NULL,
  owner_user_id TEXT,
  owner_name TEXT,

  -- KR storage (JSONB for Phase 2A)
  key_results_json JSONB DEFAULT '[]'::jsonb,

  -- Status & ordering
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  sort_order INTEGER DEFAULT 0,

  -- Source tracking (for migration period)
  source_stage TEXT CHECK (source_stage IN ('stage3', 'stage4', 'stage5')),
  source_okr_id TEXT,  -- Reference to legacy okr.id if exists

  -- Soft delete
  is_deleted BOOLEAN DEFAULT false,

  -- Audit
  meta_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  -- Indexing
  UNIQUE(strategy_id, department_id, project_id, id) WHERE is_deleted = false
);

CREATE INDEX idx_okrs_company_id ON okrs(company_id);
CREATE INDEX idx_okrs_strategy_id ON okrs(strategy_id);
CREATE INDEX idx_okrs_project_id ON okrs(project_id);
CREATE INDEX idx_okrs_sort_order ON okrs(project_id, sort_order);

-- RLS Policy (同一 company 内でのアクセス許可)
ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can read okrs" ON okrs
  FOR SELECT USING (
    company_id IN (
      SELECT id FROM user_companies WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Company admins can insert okrs" ON okrs
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Company admins can update okrs" ON okrs
  FOR UPDATE USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

### B. strategy_data テーブルへの変更（軽微）

```sql
-- 既存テーブルへの追加列（migration用）
ALTER TABLE strategy_data
ADD COLUMN IF NOT EXISTS okrs_table_synced_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS okrs_migration_status TEXT DEFAULT 'pending';

-- Index: strategy_data への高速アクセス
CREATE INDEX IF NOT EXISTS idx_strategy_data_company_id ON strategy_data(company_id);
```

### C. progress_logs テーブルへの変更（軽微）

```sql
-- 既存 progress_logs に okr_id を mandatory に（段階的）
-- Phase 2A では optional のまま、Phase 2B で mandatory 化を検討
ALTER TABLE progress_logs
ADD COLUMN IF NOT EXISTS okr_id UUID REFERENCES okrs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_progress_logs_okr_id ON progress_logs(okr_id);
```

### D. Backfill SQL (参考)

```sql
-- strategy_data から okrs テーブルへ移行（idempotent）
-- ※ アプリケーション層で実行、またはトランザクション内で慎重に実行
WITH okr_data AS (
  SELECT
    sd.company_id,
    sd.id as strategy_id,
    dept->>'name' as department_name,
    COALESCE((dept->>'id')::uuid, gen_random_uuid()) as department_id,
    proj->>'title' as project_title,
    COALESCE((proj->>'id')::text, proj->>'title') as project_id,
    (okr->>'id')::text as okr_id,
    okr->>'objective' as objective,
    okr->'owner' as owner_user_id,
    okr->>'ownerName' as owner_name,
    okr->'keyResults' as key_results_json,
    NOW() as created_at
  FROM strategy_data sd,
       jsonb_array_elements(sd.departments) dept,
       jsonb_array_elements(dept->'projects') proj,
       jsonb_array_elements(proj->'okrs') okr
  WHERE sd.company_id IS NOT NULL
    AND okr->>'objective' IS NOT NULL
)
INSERT INTO okrs (
  company_id, strategy_id, department_id, project_id,
  objective, owner_user_id, owner_name,
  key_results_json, created_at
)
SELECT * FROM okr_data
ON CONFLICT (strategy_id, department_id, project_id, id) DO NOTHING;
```

---

## Ⅲ-1. 型方針・ID戦略の明確化（Phase 2A-2 実装前の重要確認）

### 1. department_id / project_id の型方針

| 項目 | ルール |
|------|--------|
| **DB型** | `TEXT` ベース（Phase 2A では OK） |
| **アプリ要件** | stable id を**必須化**すること |
| **禁止** | title ベースの紐づけは絶対禁止 |
| **将来** | Phase 2B/2C で UUID 正規化を検討 |

**実装指針:**
```typescript
// ❌ 禁止：title ベース
const projectByTitle = projects.find(p => p.title === 'プロジェクトA');

// ✅ 必須：id ベース
const projectById = projects.find(p => p.id === projectId);

// normalize 時に id 補完（必須）
projects = projects.map(p => ({
  ...p,
  id: p.id || genStableId(p)  // 既存 title/position から生成
}));
```

### 2. owner_user_id の型方針

| 層 | 型 | ルール |
|----|-----|--------|
| **DB (okrs テーブル)** | `UUID` または `TEXT` | UUID を優先推奨 |
| **フロント (OkrWriteInput)** | `string` | string のまま可（Repository で変換） |
| **Repository / Service** | 型変換層 | DB ↔ UI の型を吸収 |

**実装指針:**
```typescript
// Repository 層で型変換
class OkrsRepository {
  async upsert(input: OkrWriteInput): Promise<OkrRow> {
    // フロント: owner_user_id: string
    // ↓
    // DB: owner_user_id: UUID に変換（可能ならば）
    const dbPayload = {
      ...input,
      owner_user_id: input.owner_user_id  // UUID または null
    };
    // ↓
    // Supabase へ save
  }
}
```

**絶対禁止:**
```typescript
// ❌ Project owner と KPI owner を混同
project.owner_user_id = okr.owner_user_id;  // 厳禁！

// ✅ 分離維持
project.ownerUserId = userA;      // Project owner
okr.owner_user_id = userB;        // KPI owner
```

### 3. soft delete の read ルール

| 操作 | 実装ルール |
|------|-----------|
| **DELETE** | `UPDATE okrs SET is_deleted = true` |
| **READ** | **常に** `WHERE is_deleted = false` |
| **Snapshot 同期** | 削除済み OKR を混ぜない |
| **防止** | 削除後の再注入を絶対に防止 |

**実装指針:**
```typescript
// Repository: 常に is_deleted = false フィルター
async queryByProjectId(projectId: string): Promise<OkrRow[]> {
  const { data } = await supabase
    .from('okrs')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_deleted', false)  // ← 必須
    .order('sort_order', { ascending: true });

  return data ?? [];
}

// Soft delete
async softDelete(okrId: string): Promise<void> {
  await supabase
    .from('okrs')
    .update({ is_deleted: true })
    .eq('id', okrId);
}

// Snapshot 同期時も削除済みを除外
async syncOkrsSnapshotToStrategyData(projectId: string): Promise<void> {
  // ✅ is_deleted = false のみ取得
  const activeOkrs = await okrsRepository.queryByProjectId(projectId);

  // snapshot にも activeOkrs だけを反映
  // （削除済みは snapshot からも除外）
  updateProjectInStore(projectId, {
    okrs: activeOkrs.map(o => ({...}))
  });
}
```

**削除済み OKR の再注入防止:**
```typescript
// backfill 時
INSERT INTO okrs (...)
SELECT ...
WHERE is_deleted IS NULL OR is_deleted = false;
-- ↑ 削除済みは backfill しない

// progress_logs 参照
const okr = await okrsRepository.queryById(okrId);
// is_deleted = true の OKR は返さない
// → progress_logs が deleted OKR を参照しようとしても、
//   resolveProjectsWithOkrs() で削除済みは除外される
```

---

## Ⅳ. 型変更方針

### A. 新規型（`types/okrs.ts`）

```typescript
// DB層：Supabase から直接来るデータ
export type OkrRow = {
  id: UUID;
  company_id: UUID;
  strategy_id: UUID;
  department_id: string;
  project_id: string;
  objective: string;
  owner_user_id?: string;
  owner_name?: string;
  key_results_json: any[];  // JSONB形式
  status: 'draft' | 'active' | 'completed' | 'archived';
  sort_order: number;
  source_stage?: 'stage3' | 'stage4' | 'stage5';
  source_okr_id?: string;  // Legacy reference
  is_deleted: boolean;
  meta_json?: Record<string, any>;
  created_at: string;
  updated_at: string;
};

// Write層：画面からのInput
export type OkrWriteInput = Omit<
  OkrRow,
  'id' | 'company_id' | 'strategy_id' | 'created_at' | 'updated_at' | 'is_deleted'
> & {
  id?: UUID;  // UPSERTの場合に指定
};

// UI層：表示用（okrs table + snapshot fallback merged）
export type ResolvedOkr = OkrRow & {
  source: 'db' | 'snapshot';  // どちらから来たか
};

// Project単位でOKRを束ねた形式（STAGE4/5で使用）
export type ProjectWithResolvedOkrs = Project & {
  resolvedOkrs: ResolvedOkr[];  // strategy_data.projects[].okrs ではなく okrs table から解決
};
```

### B. 既存型の修正（`types/strategy.ts`）

```typescript
// Department型に id 追加
export type Department = {
  id?: UUID | string;      // ← 新規追加: 安定ID
  name: string;
  mission: string;
  // ... その他フィールド変わらず ...
  projects: Project[];
  finalized: boolean;
};

// Project型に id 追加 + OKR参照仕様明確化
export type Project = {
  id?: UUID | string;      // ← 新規追加: 安定ID
  title: string;           // (変わらず)

  // Legacy OKRs（Phase 2A では snapshot / fallback用）
  okrs?: OKR[];            // ← 用途明確化: snapshot/fallback

  // 新: OKR正本は okrs テーブルから解決
  // (フィールドとしては存在しない、resolveProjectsWithOkrs() で組み立て)

  // ... 他フィールド変わらず ...
};

// OKR型は変わらず（互換性重視）
export type OKR = {
  id?: string;
  objective: string;
  keyResults: string[];
  owner?: string;           // ← (Phase 2B で okr_owner_name へ改名検討)
  // ...
};
```

### C. 型変更ポリシー

| 原則 | 説明 |
|-----|------|
| **Backward Compatible** | 既存フィールド削除なし。optional フィールド追加のみ |
| **Double Representation** | 移行期間中は okrs table と snapshot が共存。merge ロジックで統一 |
| **Source Tracking** | ResolvedOkr に source フィールドで「どこから来たか」を記録 |
| **No Breaking Changes** | 画面の save/restore フロー変わらず |

---

## Ⅴ. 保存 / 読込フロー図

### A. 読込フロー（優先順位あり）

```
[STAGE4 / STAGE5 で OKR 読込要求]
          ↓
    OkrService.resolveProjectsWithOkrs(projectId)
          ↓
    ┌─────┴─────┐
    ↓           ↓
 [okrs table]  [strategy_data snapshot]
 (正本)         (fallback)
    ↓           ↓
  Query DB   getProjectFromStore()
    ↓           ↓
  okrRows?   snapshotOkrs?
    ├─→ YES → merge(db + snapshot)    ← DB優先
    └─→ NO  → snapshotOkrs?
             ├─→ YES → use snapshot + source:'snapshot'
             └─→ NO  → return []

Result: ResolvedOkr[]
  - okrs table から取得 → source: 'db'
  - snapshot から取得 → source: 'snapshot'
```

### B. 保存フロー（STAGE4優先実装）

```
[User saves OKR in STAGE4]
          ↓
  OkrService.upsertOkr(input)
          ↓
    ┌─────────────────────┐
    ↓                     ↓
[upsert to okrs]    [start transaction]
  table (正本)
    ↓
  success?
    ├─→ YES → syncOkrsSnapshotToStrategyData()
    │         (strategy_data 側 snapshot 更新)
    │           ↓
    │      Save strategy_data (saveStrategyData())
    │           ↓
    │      transaction.commit()
    │           ↓
    │      return { success: true, okrId }
    │
    └─→ NO  → rollback
             return { success: false, error }
```

### C. 削除フロー（soft delete）

```
[User deletes OKR]
          ↓
OkrService.deleteOkr(okrId)
          ↓
UPDATE okrs SET is_deleted = true
  WHERE id = okrId
          ↓
syncOkrsSnapshotToStrategyData()
  (snapshot 側からも OKR 除外)
          ↓
再読込時に is_deleted = false のみ取得
```

### D. Reorder フロー

```
[User reorders KPI in STAGE4]
          ↓
OkrService.reorderOkrs(projectId, orderedIds)
          ↓
BEGIN TRANSACTION
  ↓
FOR EACH id IN orderedIds:
  UPDATE okrs SET sort_order = position
  WHERE id = id
  ↓
syncOkrsSnapshotToStrategyData()
  (snapshot 内 okrs[] を同順に並べ替え)
  ↓
COMMIT
```

---

## Ⅵ. リスク一覧

| # | リスク | 深刻度 | 対策 |
|---|--------|--------|------|
| 1 | OKR ID が無いレガシーデータの喪失 | 高 | backfill 時に安定ハッシュ or UUID 補完、テスト |
| 2 | strategy_data snapshot と okrs テーブルの不整合 | 高 | syncOkrsSnapshotToStrategyData() を Service 層に一元化、テスト |
| 3 | Project owner と KPI owner の混同 | 高 | 型明確化、KPI owner を okr.owner_name に統一、コメント記載 |
| 4 | STAGE3/4/5 で異なるOKR merge ロジック | 中 | resolveProjectsWithOkrs() 統一関数を作成、全画面で使用 |
| 5 | progress_logs の okr_id 参照失敗 | 中 | Nullable にして段階的に mandatory化、fallback ロジック用意 |
| 6 | Backfill 実行漏れ → 新 okrs テーブルが空のまま | 中 | 監視スクリプト作成、admin debug API で確認可能に |
| 7 | 既存 OKR の重複 insert | 中 | UNIQUE 制約 + idempotent backfill、テスト |
| 8 | STAGE3 cannonical sync の責務曖昧化 | 低 | sync ロジックを Service 層へ移行、コメント追加 |
| 9 | STAGE3 AI生成 OKR の okrs table 反映漏れ | 中 | AI生成直後に upsertOkr() 呼出、テスト |
| 10 | RLS Policy による権限漏洩 | 高 | company_id ベース確認済み、audit 実施 |

---

## Ⅶ. 実装順序（推奨）

### Phase 2A-1: 分析・計画 ✅ **← 現在位置**

- [x] 現状コード調査
- [x] 型と責務の整理
- [x] 安定 ID 方針整理
- [x] 本計画書作成

### Phase 2A-2: インフラ整備

**順序：**
1. **okrs テーブル新設** (SQL migration)
2. **型追加** (`types/okrs.ts`, `types/strategy.ts` 拡張)
3. **OKR Repository 層** (`utils/supabase/okrsRepository.ts`)
4. **OKR Service 層** (`services/okrService.ts`) - resolveProjectsWithOkrs() 最優先
5. **ID 補完ロジック** (`utils/supabase/migration.ts`)

**納期:** 3-4 日想定

### Phase 2A-3: Backfill & Migration

1. **Backfill script 実装** (migration.ts)
2. **Staging 環境でテスト**
3. **本番 data backfill 実行** (transaction 内, 検証後)
4. **okrs table 確認** (debug API)

**納期:** 2 日想定

### Phase 2A-4: STAGE4 切替（最優先）

1. **okrs 正本読込に切替** (resolveProjectsWithOkrs 統合)
2. **add/edit/delete を okrs へ寄せる**
3. **保存時に snapshot sync**
4. **再読込テスト**

**納期:** 2-3 日想定

### Phase 2A-5: STAGE5 切替

1. **progress_logs の okr_id 参照に統一**
2. **既存ログの fallback 互換性確保**
3. **テスト**

**納期:** 1-2 日想定

### Phase 2A-6: STAGE3 慎重移行

1. **okrs 優先 + snapshot fallback に統一**
2. **AI生成 OKR → okrs table 反映**
3. **canonical sync 責務を Service 層へ移行**
4. **STAGE4 との整合テスト**

**納期:** 3-4 日想定

**全体納期:** 11-16 日想定

---

## Ⅷ. 完了後の確認観点

### チェックリスト

#### インフラ層
- [ ] okrs テーブルが作成済み
- [ ] strategy_data テーブルに migration_status カラムあり
- [ ] RLS Policy が正しく設定済み
- [ ] Index が作成済み

#### Backfill
- [ ] strategy_data 内の全 OKR が okrs テーブルへ移行
- [ ] OKR ID が安定している（重複なし）
- [ ] Department ID / Project ID が補完済み
- [ ] Backfill 実行前後でデータ件数が一致

#### STAGE4 テスト
- [ ] STAGE4 で新規 OKR 追加 → okrs テーブルに保存される
- [ ] 再読込後も OKR が表示される
- [ ] OKR 編集 → okrs テーブルが更新される
- [ ] OKR 削除 → soft delete (is_deleted = true)
- [ ] reorder → sort_order が保存される
- [ ] Project owner と KPI owner が分離表示される
- [ ] snapshot 側も同期されている

#### STAGE5 テスト
- [ ] 既存 progress_log が表示される（fallback OK）
- [ ] 新規 progress_log は okr_id を持つ
- [ ] okr_id で OKR 参照できる

#### STAGE3 テスト
- [ ] KPI 追加 → okrs テーブルに反映される
- [ ] KPI 編集 → STAGE4 でも見える（整合性確認）
- [ ] KPI 削除 → STAGE4 でも消える
- [ ] AI生成 OKR → okrs テーブルに反映される
- [ ] snapshot fallback で既存データが読める

#### エッジケース
- [ ] 削除済み OKR が復活しない
- [ ] Concurrent 編集が race condition にならない
- [ ] Migration 中の部分的読込が安全（transaction）
- [ ] Company 別 OKR が混在しない（RLS）
- [ ] User 権限が守られている（admin only write）

#### パフォーマンス
- [ ] okrs テーブル query が遅くない（Index確認）
- [ ] snapshot sync がバッチ可能
- [ ] backfill が reasonable time で完了

#### 既存機能維持
- [ ] Admin pages で OKR が読める
- [ ] Member pages で自身の OKR が読める
- [ ] Auth flow に影響なし
- [ ] API routes が正常

---

## Ⅸ. 次ステップ

### 即座に必要な承認

1. **DB Migration SQL 承認**
   - okrs テーブルスキーマ
   - RLS Policy
   - Backfill SQL

2. **型定義方針承認**
   - OkrRow / OkrWriteInput / ResolvedOkr
   - Department/Project への id 追加

3. **実装優先順序承認**
   - Phase 2A-2 → 2A-3 → ... の順序

### 実装着手の準備

1. Feature branch 作成: `feature/phase-2a-okr-canonicalization`
2. Staging 環境への migration 実行テスト
3. Test dataset 準備（backfill テスト用）
4. Code review ルール確認（特に snapshot sync, source tracking）

---

**計画書作成者:** Claude Code Assistant
**版:** 1.0
**最終レビュー日:** 2026-03-16
