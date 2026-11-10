-- ============================================================
-- 【未適用】20261110_stage4_plan_documents.sql の直後に適用する権限の絞り込み。
-- 理由: Supabaseの既定権限では、anon と authenticated に新しい表の全権限（TRUNCATEを含む）が付く。
--       RLS は TRUNCATE に効かないため、このままでは会社をまたいで計画書と操作履歴を消せてしまう。
-- 方針: 既存の本番の表と同じく、authenticated は DELETE / INSERT / SELECT / UPDATE まで。
--       履歴は読むだけ（書き込みはトリガーだけが行う）。anon には与えない。
-- 影響: 新しく作った2つの表と関数の権限だけを変える。既存の表・データには触れない。
-- ============================================================

revoke all on table public.stage4_plan_documents from anon, authenticated;
grant select, insert, update, delete on table public.stage4_plan_documents to authenticated;

revoke all on table public.stage4_plan_document_events from anon, authenticated;
grant select on table public.stage4_plan_document_events to authenticated;

revoke execute on function public.stage4_assign_project_identity(uuid, uuid, integer, integer, text, integer, text) from anon;

-- ロールバック（権限の戻し。表は消さない）
-- grant all on table public.stage4_plan_documents to anon, authenticated;
-- grant all on table public.stage4_plan_document_events to anon, authenticated;
-- grant execute on function public.stage4_assign_project_identity(uuid, uuid, integer, integer, text, integer, text) to anon;
