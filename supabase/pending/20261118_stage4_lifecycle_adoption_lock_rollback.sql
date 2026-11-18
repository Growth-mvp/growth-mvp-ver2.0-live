-- ============================================================
-- 切り戻し: 20261118_stage4_lifecycle_adoption_lock.sql の追加分だけを外す
-- 既存の表・行・関数・トリガーには触れない（追加したものを削除するだけ）。
-- 1トランザクションで実行する。
-- ============================================================
begin;

drop trigger if exists stage4_plan_documents_lifecycle_trg on public.stage4_plan_documents;
drop function if exists public.stage4_guard_plan_adoption_lifecycle();

drop trigger if exists trg_strategy_data_stage4_lifecycle_guard on public.strategy_data;
drop function if exists public.stage4_guard_project_lifecycle();

commit;
