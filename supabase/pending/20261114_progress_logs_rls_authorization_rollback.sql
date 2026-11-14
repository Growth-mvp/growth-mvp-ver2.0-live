-- ============================================================
-- 【切り戻し】20261114_progress_logs_rls_authorization.sql を適用前の状態に戻す。
-- 既存データは変更しない。1トランザクションで実行する。
-- 本番スナップショット（schema_remote_20260708.sql L1900-1922）と同じ4本のポリシーを復元する。
-- ============================================================

begin;

drop policy if exists progress_logs_select on public.progress_logs;
drop policy if exists progress_logs_insert on public.progress_logs;
drop policy if exists progress_logs_update on public.progress_logs;
drop policy if exists progress_logs_delete on public.progress_logs;

create policy progress_logs_delete on public.progress_logs for delete to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_insert on public.progress_logs for insert to authenticated
  with check (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_select on public.progress_logs for select to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));
create policy progress_logs_update on public.progress_logs for update to authenticated
  using (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id))
  with check (exists (select 1 from public.company_members m where m.user_id = auth.uid() and m.company_id = progress_logs.company_id));

drop trigger if exists progress_logs_guard_identity_trg on public.progress_logs;
drop function if exists rls_private.progress_logs_guard_identity();
drop function if exists rls_private.is_feedback(text);
drop function if exists rls_private.okr_in_company(uuid, uuid);
drop function if exists rls_private.is_admin(uuid);
drop function if exists rls_private.is_member(uuid);
drop schema if exists rls_private;

commit;
