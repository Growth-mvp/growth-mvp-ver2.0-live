-- ============================================================
-- 切り戻し：strategy_data の DELETE を、本番の観測時点（2026-11-24）の定義に戻す。
-- 観測時点の定義は role = 'admin' の管理者のみ（20261124_strategy_data_delete_admin_only.sql と同じ）。
-- 旧版（所属者なら削除可）に戻す必要がある場合は、別途その定義を明示して適用すること。
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
