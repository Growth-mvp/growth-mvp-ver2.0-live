-- ============================================================
-- strategy_data の DELETE を管理者（admin）だけに制限する定義。
--
-- 確認結果（2026-11-24、本番 yuerkbxpivdhaikrnsar の pg_policies を読み取り専用で確認）：
--   strategy_delete は既に role = 'admin' の定義になっていた。
--   したがって本SQLは本番に対して「同じ定義を作り直す」だけで、適用による変更はない。
--   本番での適用は不要。旧版の定義（所属者なら削除可）の環境へ移す場合にのみ使う。
--
-- 残存（方針どおり変えない）：UPDATE（所属者の保存）、INSERT、SELECT。
-- 切り戻し：20261124_strategy_data_delete_admin_only_rollback.sql（本番の観測時点の定義に戻す）。
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
