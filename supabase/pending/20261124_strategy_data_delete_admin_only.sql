-- ============================================================
-- 【未適用】strategy_data の DELETE を管理者（admin）だけに制限する。
-- 本番DBへの適用は、報告後の承認の後に行う。
--
-- 背景: 現行の strategy_delete は「同じ企業の所属者なら誰でも削除可」になっている。
--       アプリの通常処理（保存・更新・実行開始・STAGE2〜6の操作）は strategy_data を削除しない
--       （DELETE は全削除API＝サービスロール＝RLSの対象外、と未使用のヘルパーだけ）。
-- 変更: strategy_delete の条件に「role = 'admin'」を加えるだけ。SELECT・INSERT・UPDATE は変えない。
-- 残存: UPDATE は限定的なPoC期間の残存リスクとして管理する（本SQLでは変えない）。
-- 切り戻し: 20261124_strategy_data_delete_admin_only_rollback.sql
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "strategy_delete" ON public.strategy_data;

CREATE POLICY "strategy_delete" ON public.strategy_data
  FOR DELETE TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_members m
      WHERE m.user_id = auth.uid()
        AND m.company_id = strategy_data.company_id
        AND m.role = 'admin'
    )
  );

COMMIT;
