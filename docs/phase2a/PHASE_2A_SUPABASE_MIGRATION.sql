-- ============================================================
-- Phase 2A: OKR 正本化テーブル作成 SQL
-- 実行環境: Supabase SQL Editor
-- 実行順序: 上から順に実行すること
-- ============================================================

-- ★ STEP 1: okrs テーブル作成
-- ============================================================

CREATE TABLE IF NOT EXISTS okrs (
  -- Primary key & company scoping
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- OKR relationship
  strategy_id UUID NOT NULL,
  department_id TEXT NOT NULL,        -- TEXT ベース（Phase 2A）、アプリ側で stable id 必須化
  project_id TEXT NOT NULL,           -- TEXT ベース（Phase 2A）、アプリ側で stable id 必須化

  -- OKR content
  objective TEXT NOT NULL,
  key_results_json JSONB DEFAULT '[]'::jsonb,  -- JSONB で KR 配列を保存

  -- Ownership
  owner_user_id UUID,                 -- DB 側は UUID 推奨（フロント型変換は Repository で吸収）
  owner_name TEXT,                    -- KPI担当の表示名

  -- Status & ordering
  status TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  sort_order INTEGER DEFAULT 0,       -- プロジェクト内での並び順

  -- Migration tracking
  source_stage TEXT
    CHECK (source_stage IN ('stage3', 'stage4', 'stage5', 'migration')),
  source_okr_id TEXT,                 -- レガシー okr.id 参照（backfill 用）

  -- Soft delete（削除後の復活防止）
  is_deleted BOOLEAN DEFAULT false,

  -- Audit & metadata
  meta_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID,
  updated_by UUID,

  -- ★ Approach A: Uniqueness constraint（soft delete 対応）
  -- Ensures one OKR per (strategy, department, project, objective)
  -- Prevents duplicate DB-backed OKRs from multiple upsert calls
  UNIQUE(strategy_id, department_id, project_id, objective) WHERE is_deleted = false
) PARTITION BY HASH (company_id);

-- コメント
COMMENT ON TABLE okrs IS 'OKR 正本テーブル（Phase 2A）。strategy_data から段階的に移行。';
COMMENT ON COLUMN okrs.is_deleted IS 'Soft delete フラグ。削除は is_deleted = true。読込時は常に false フィルター。';
COMMENT ON COLUMN okrs.owner_user_id IS 'KPI担当（Project owner の ownerUserId とは別）。';
COMMENT ON COLUMN okrs.source_stage IS 'OKR の生成元ステージ（AI生成/手動）。';

-- ============================================================
-- ★ STEP 2: インデックス作成（クエリ性能）
-- ============================================================

-- 会社単位・戦略単位での高速検索
CREATE INDEX idx_okrs_company_id
  ON okrs(company_id)
  WHERE is_deleted = false;

CREATE INDEX idx_okrs_strategy_id
  ON okrs(strategy_id)
  WHERE is_deleted = false;

-- プロジェクト単位での高速検索（並び順付き）
CREATE INDEX idx_okrs_project_id_sort
  ON okrs(project_id, sort_order)
  WHERE is_deleted = false;

-- soft delete 除外フィルター用
CREATE INDEX idx_okrs_is_deleted
  ON okrs(is_deleted);

-- OKR ID 逆引き（progress_logs から reference）
CREATE INDEX idx_okrs_id
  ON okrs(id)
  WHERE is_deleted = false;

-- owner_user_id で検索（Phase 2B で権限制御時に活用）
CREATE INDEX idx_okrs_owner_user_id
  ON okrs(owner_user_id, company_id)
  WHERE is_deleted = false;

-- ============================================================
-- ★ STEP 3: RLS Policy（Row Level Security）設定
-- ============================================================

ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;

-- Policy 1: ユーザーの会社内 OKR 読取可能
CREATE POLICY "Users can read okrs in their company" ON okrs
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
    )
  );

-- Policy 2: 会社管理者（admin）のみ OKR insert 可能
CREATE POLICY "Company admins can insert okrs" ON okrs
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Policy 3: 会社管理者（admin）のみ OKR update 可能
CREATE POLICY "Company admins can update okrs" ON okrs
  FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Policy 4: 会社管理者（admin）のみ OKR delete（soft delete）可能
CREATE POLICY "Company admins can delete okrs" ON okrs
  FOR DELETE
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================================
-- ★ STEP 4: progress_logs テーブルへの拡張（参照用）
-- ============================================================

-- progress_logs に okr_id カラムを追加（段階的に mandatory 化）
ALTER TABLE progress_logs
ADD COLUMN IF NOT EXISTS okr_id UUID REFERENCES okrs(id) ON DELETE SET NULL;

-- progress_logs.okr_id へのインデックス
CREATE INDEX IF NOT EXISTS idx_progress_logs_okr_id
  ON progress_logs(okr_id)
  WHERE okr_id IS NOT NULL;

-- ============================================================
-- ★ STEP 5: strategy_data テーブルへの追加情報（sync 追跡用）
-- ============================================================

-- strategy_data に okrs テーブル同期状態を記録（監視・debug用）
ALTER TABLE strategy_data
ADD COLUMN IF NOT EXISTS okrs_table_synced_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE strategy_data
ADD COLUMN IF NOT EXISTS okrs_migration_status TEXT DEFAULT 'pending'
  CHECK (okrs_migration_status IN ('pending', 'in_progress', 'completed', 'error'));

COMMENT ON COLUMN strategy_data.okrs_table_synced_at IS 'okrs テーブルへの最後の同期日時。';
COMMENT ON COLUMN strategy_data.okrs_migration_status IS 'Backfill ステータス。pending → in_progress → completed。';

-- ============================================================
-- ★ STEP 6: Backfill 前の検証クエリ
-- ============================================================

-- 検証 A: Backfill対象の OKR 件数（department.id && project.id 必須）
-- 実行結果: Phase 2A-3 Backfill 後の件数と一致するはず
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
  AND (dept->>'id') IS NOT NULL
  AND (proj->>'id') IS NOT NULL;

-- 検証 A2: Skip される OKR 件数（department.id or project.id がない）
-- 実行結果: ユーザーは Phase 1.5 で id 整備を検討
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

-- 検証 B2: okrsV2-only プロジェクト（okrs[] は空、okrsV2[] がある）
-- 実行結果: 自動移行なし（Phase 2C で KR テーブル化予定）
SELECT
  COUNT(DISTINCT (proj->>'id')) as okrsV2_only_project_count,
  SUM(jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb))) as total_okrsV2_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj
WHERE (proj->>'id') IS NOT NULL
  AND jsonb_array_length(COALESCE(proj->'okrs', '[]'::jsonb)) = 0
  AND jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb)) > 0;

-- 検証 2: Backfill 後に okrs テーブル件数を確認
-- 実行結果: 上記と同じ件数であることを確認
SELECT
  COUNT(*) as okrs_table_count,
  COUNT(DISTINCT strategy_id) as strategy_count,
  COUNT(DISTINCT department_id) as department_count,
  COUNT(DISTINCT CASE WHEN is_deleted = false THEN id END) as active_okr_count
FROM okrs;

-- 検証 3: Soft delete 除外の確認
-- 実行結果: is_deleted = true の行は読取されない
SELECT COUNT(*) as deleted_okr_count
FROM okrs
WHERE is_deleted = true;

-- ============================================================
-- ★ STEP 7: Backfill スクリプト（アプリケーション層で実行）
-- ============================================================

-- ※ このクエリはアプリの backfillOkrs.ts で実行される
-- ※ transaction 内で実行し、失敗時は rollback
-- ※ department.id と project.id が必須（title fallback は禁止）

/*
WITH okr_data AS (
  SELECT
    sd.company_id,
    sd.id as strategy_id,
    dept->>'id' as department_id,              -- ★ id 必須（fallback なし）
    proj->>'id' as project_id,                 -- ★ id 必須（fallback なし）
    COALESCE(okr->>'id', '')::text as okr_id_raw,  -- null 対応
    okr->>'objective' as objective,
    CASE
      WHEN okr->>'owner' ~ '^[0-9a-f]{8}-[0-9a-f]{4}' THEN (okr->>'owner')::uuid
      ELSE NULL
    END as owner_user_id,                       -- ★ UUID チェック必須
    COALESCE(okr->>'ownerName', okr->>'owner', '') as owner_name,
    okr->'keyResults' as key_results_json,
    okr->>'id' as source_okr_id,
    'migration' as source_stage,
    false as is_deleted,
    sd.updated_at as created_at                 -- strategy_data の更新日時
  FROM strategy_data sd,
       jsonb_array_elements(sd.departments) dept,
       jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
       jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
  WHERE sd.company_id IS NOT NULL
    AND okr->>'objective' IS NOT NULL          -- ★ objective 必須
    AND (dept->>'id') IS NOT NULL              -- ★ department.id 必須
    AND (proj->>'id') IS NOT NULL              -- ★ project.id 必須
)
INSERT INTO okrs (
  id, company_id, strategy_id, department_id, project_id,
  objective, owner_user_id, owner_name,
  key_results_json, source_okr_id, source_stage, is_deleted, created_at,
  updated_at, created_by, updated_by
)
SELECT
  CASE
    WHEN okr_id_raw != '' THEN okr_id_raw::uuid  -- okr.id がある（そのまま使用）
    ELSE gen_random_uuid()  -- ★ TODO: アプリ層で決定的生成に変更（UUID5 or hash-based）
                            -- Seed = strategy_id:department_id:project_id:objective:sort_order
                            -- 何度実行しても同じ ID になるように実装必須
  END as id,
  company_id, strategy_id, department_id, project_id,
  objective, owner_user_id, owner_name,
  COALESCE(key_results_json, '[]'::jsonb) as key_results_json,
  source_okr_id, source_stage, is_deleted, created_at,
  NOW() as updated_at,
  (SELECT user_id FROM strategy_data sd2 WHERE sd2.id = strategy_id LIMIT 1) as created_by,
  (SELECT user_id FROM strategy_data sd2 WHERE sd2.id = strategy_id LIMIT 1) as updated_by
FROM okr_data
ON CONFLICT (strategy_id, department_id, project_id, id) DO NOTHING;

-- Backfill 後に sync 状態を更新
UPDATE strategy_data
SET okrs_table_synced_at = NOW(),
    okrs_migration_status = 'completed'
WHERE okrs_migration_status = 'in_progress';
*/

-- ============================================================
-- ★ STEP 8: 本番デプロイ前の確認クエリ
-- ============================================================

-- 確認 1: RLS が有効か
SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'okrs';

-- 確認 2: インデックスが作成済みか
SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE tablename = 'okrs'
ORDER BY indexname;

-- 確認 3: soft delete 읽取이 正しく動作するか
-- 結과: is_deleted = false のみが返される
SELECT id, objective, is_deleted
FROM okrs
WHERE company_id = 'YOUR_COMPANY_ID'  -- テスト用 company_id を指定
ORDER BY created_at DESC
LIMIT 10;

-- 確認 4: 삭제된 OKR가 읽히지 않는지 확인
SELECT COUNT(*) as should_be_zero
FROM okrs
WHERE is_deleted = false AND is_deleted = true;  -- 논리적으로 불가능, 결과는 0

-- ============================================================
-- ★ 실행 完了確認
-- ============================================================

-- テーブル・インデックス・Policy が正しく作成されているか
SELECT
  'okrs' as table_name,
  COUNT(*) as column_count,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'okrs') as index_count,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'okrs') as policy_count
FROM information_schema.columns
WHERE table_name = 'okrs';

-- 期待結果:
-- table_name | column_count | index_count | policy_count
-- okrs       | 19           | 6           | 4
