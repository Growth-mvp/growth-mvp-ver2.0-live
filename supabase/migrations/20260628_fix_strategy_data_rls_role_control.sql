-- ============================================================
-- ⚠️ 【適用保留】このmigrationはPoC前には適用しないでください
--
-- 理由: STAGE4のデータ（project_target_impacts, okr_target_scores等）が
--      strategy_dataテーブルに保存されており、memberの編集を制限すると
--      STAGE4の保存機能が壊れる可能性があるため
--
-- 適用予定: PoC後にSTAGE4データをexecution_plansテーブル等に分離してから
-- 分離設計: docs/spec/19-RLS-POC-strategy-final-decision.md 参照
--
-- ============================================================
-- Migration: strategy_data の RLS ポリシーに role 制御を追加
-- 目的: STAGE1-3 では manager/admin のみが strategy_data を編集可能とする
-- 実行環境: Supabase SQL Editor
-- 実行前チェック: company_members テーブルが存在し、role カラムがあること
-- ============================================================

-- ========== STEP 1: 既存ポリシーをすべて削除 ==========
DROP POLICY IF EXISTS "strategy_select" ON strategy_data;
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;

-- ========== STEP 2: SELECT ポリシー（現状維持）==========
-- 同じ company_id の company_members に所属していれば、member/manager/admin すべて読取可能
CREATE POLICY "strategy_select"
  ON strategy_data
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  );

-- ========== STEP 3: INSERT ポリシー（role 制御追加）==========
-- manager / admin のみが INSERT 可能
CREATE POLICY "strategy_insert"
  ON strategy_data
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

-- ========== STEP 4: UPDATE ポリシー（role 制御追加）==========
-- manager / admin のみが UPDATE 可能
CREATE POLICY "strategy_update"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

-- ========== STEP 5: DELETE ポリシー（role 制御追加）==========
-- admin のみが DELETE 可能
CREATE POLICY "strategy_delete"
  ON strategy_data
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- ========== STEP 6: 適用確認 ==========
-- 以下のSQLを実行して、修正されたポリシーを確認
/*
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;
*/
