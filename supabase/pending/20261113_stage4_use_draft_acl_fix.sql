-- ============================================================
-- 【権限の修正】移行SQL（20261113_stage4_use_draft_migration.sql）適用後の追加修正。
-- Supabase の既定の権限設定により、public の関数に anon・authenticated・service_role へ EXECUTE が付いている。
--  - stage4_use_draft：利用者のトークンで呼ぶため authenticated だけに残し、anon と service_role を取り消す。
--  - stage4_plan_documents_owner：計画書の表を更新するたびに、トリガーが呼び出し者の権限で参照するため、
--    authenticated と service_role は残す。anon と PUBLIC からは取り消す。
-- 既存の計画書・履歴・戦略データには触れない。1トランザクション。
-- 切り戻し：必要なら grant execute ... to anon, service_role（本番では戻す必要はない）。
-- ============================================================
begin;
revoke all on function public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.stage4_use_draft(uuid, uuid, text, integer, jsonb, jsonb) to authenticated;
revoke execute on function public.stage4_plan_documents_owner() from public, anon;
commit;
