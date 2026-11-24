-- ============================================================
-- 切り戻し：strategy_data の DELETE を「所属者なら誰でも」へ戻す（20261124 の適用を取り消す）。
-- 戻す定義は、適用前に本番に存在した strategy_delete（schema_remote_20260708.sql の定義）と同じ。
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
    )
  );

COMMIT;
