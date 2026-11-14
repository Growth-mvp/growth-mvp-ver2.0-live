-- ============================================================
-- 【適用保留】progress_logs の権限修正（本番適用は未実施。適用前に必ず確認する）
--
-- 目的:
--   1. 他人の投稿を直接更新・削除できる現行ポリシーを、投稿者本人だけに限る。
--   2. 投稿の作成者 user_id を認証済み本人に固定する（なりすまし防止）。
--   3. 管理者フィードバック（本文が [FB] で始まる記録）は会社の admin だけが作成・編集・削除できる。
--      （現行STAGE5 UIの権限 canEditCompany = admin と一致させる。manager の支援は含めない）
--   4. 会社・OKR の紐づけを検証し、別企業や別OKRへの登録・変更を拒否する。
--   5. 同じ会社の社員は、従来どおり共有記録を閲覧できる（SELECT の意味は変えない）。
--
-- 方針:
--   - 判定関数は rls_private スキーマに置く。PostgREST の公開対象（public）外のため RPC として呼べない。
--     実行権限は authenticated だけに与え、PUBLIC と anon からは取り消す。
--   - 既存の progress_logs のポリシーは、名前を問わず全て削除してから作り直す。
--     許可ポリシーが1本でも残ると OR 条件で制限が効かなくなるため。
--   - service_role は RLS を迂回する。サーバー経路（delete-all 等）は各 route の権限確認に依存する。
--   - 既存データは変更・削除しない（ポリシーと関数と、更新時のガードトリガーだけを追加・置換する）。
--
-- 検証: eval/rls/progress_logs/run-isolated-rls-test.mjs（隔離 PostgreSQL・本番DBには接続しない）
-- 切り戻し: 20261114_progress_logs_rls_authorization_rollback.sql
-- ============================================================

begin;

create schema if not exists rls_private;
revoke all on schema rls_private from public;
grant usage on schema rls_private to authenticated;

-- ---- 判定関数（rls_private）----
create or replace function rls_private.is_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function rls_private.is_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

create or replace function rls_private.okr_in_company(p_okr_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.okrs o
    where o.id = p_okr_id
      and o.company_id = p_company_id
  );
$$;

-- 管理者フィードバックの判定。Stage5 の保存形式（任意の __META__ 行の後に [FB] で始まる本文）に合わせる。
create or replace function rls_private.is_feedback(p_content text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(p_content ~ '^(__META__:[^\n]*\n)?\[FB\]', false);
$$;

revoke all on function rls_private.is_member(uuid) from public, anon;
revoke all on function rls_private.is_admin(uuid) from public, anon;
revoke all on function rls_private.okr_in_company(uuid, uuid) from public, anon;
revoke all on function rls_private.is_feedback(text) from public, anon;
grant execute on function rls_private.is_member(uuid) to authenticated;
grant execute on function rls_private.is_admin(uuid) to authenticated;
grant execute on function rls_private.okr_in_company(uuid, uuid) to authenticated;
grant execute on function rls_private.is_feedback(text) to authenticated;

-- ---- 作成・更新時の識別子ガード（会社・作成者・作成日時・IDは変更できない）----
create or replace function rls_private.progress_logs_guard_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.created_at is distinct from old.created_at then
    raise exception 'progress_logs: id・company_id・created_at は変更できません'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_logs_guard_identity_trg on public.progress_logs;
create trigger progress_logs_guard_identity_trg
  before update on public.progress_logs
  for each row execute function rls_private.progress_logs_guard_identity();

-- ---- 既存ポリシーの全削除（名前を問わない。残存する許可ポリシーの OR を防ぐ）----
do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'progress_logs' loop
    execute format('drop policy if exists %I on public.progress_logs', r.policyname);
  end loop;
end
$$;

-- ---- ポリシーの作成 ----
-- 閲覧: 同じ会社の所属者（全社共有・トップ画面の集計に必要）
create policy progress_logs_select on public.progress_logs
  for select to authenticated
  using (rls_private.is_member(company_id));

-- 作成: 本人の user_id・所属会社・会社内のOKR・フィードバックは管理者のみ
create policy progress_logs_insert on public.progress_logs
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and rls_private.is_member(company_id)
    and okr_id is not null
    and rls_private.okr_in_company(okr_id, company_id)
    and (not rls_private.is_feedback(content) or rls_private.is_admin(company_id))
  );

-- 更新・削除の対象: 本人の記録のみ（フィードバックは管理者本人のみ）
create policy progress_logs_update on public.progress_logs
  for update to authenticated
  using (
    user_id = auth.uid()
    and rls_private.is_member(company_id)
    and (not rls_private.is_feedback(content) or rls_private.is_admin(company_id))
  )
  with check (
    user_id = auth.uid()
    and rls_private.is_member(company_id)
    and okr_id is not null
    and rls_private.okr_in_company(okr_id, company_id)
    and (not rls_private.is_feedback(content) or rls_private.is_admin(company_id))
  );

create policy progress_logs_delete on public.progress_logs
  for delete to authenticated
  using (
    user_id = auth.uid()
    and rls_private.is_member(company_id)
    and (not rls_private.is_feedback(content) or rls_private.is_admin(company_id))
  );

commit;
