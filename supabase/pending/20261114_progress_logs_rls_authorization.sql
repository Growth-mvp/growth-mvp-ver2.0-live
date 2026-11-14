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
-- 前提（本番の読み取り確認で確定。2026-11-14）:
--   progress_logs の既存ポリシーは下記の4本だけで、指紋 14da1ff746e1ada87be5564254dd8f39 と一致する。
--   一致しなければ、何も変えずに中止する（未知のポリシーを無条件に削除しない）。
--
-- 方針:
--   - 判定関数は rls_private スキーマに置く。PostgREST の公開対象（public）外のため RPC として呼べない。
--     判定関数の実行権限は authenticated だけに与え、PUBLIC と anon からは取り消す。
--     トリガー関数には利用者ロールの実行権限を与えない。
--   - 削除するのは、前提で確認した4本だけ。
--   - service_role は RLS を迂回する。サーバー経路（delete-all 等）は各 route の権限確認に依存する。
--   - 既存データは変更・削除しない（ポリシーと関数と、更新時のガードトリガーだけを追加・置換する）。
--
-- 検証: eval/rls/progress_logs/run-postgrest-rls-test.mjs（実 PostgreSQL 17 + PostgREST 12。本番には接続しない）
-- 切り戻し: 20261114_progress_logs_rls_authorization_rollback.sql
-- ============================================================

begin;

-- ---- 前提の確認（本番で確認したポリシーの指紋と一致しなければ中止）----
do $$
declare
  v_count integer;
  v_fp text;
begin
  select count(*),
         md5(string_agg(concat_ws('|', policyname, permissive, cmd, array_to_string(roles, ','),
                                  coalesce(qual, ''), coalesce(with_check, '')),
                        E'\n' order by policyname))
    into v_count, v_fp
  from pg_policies
  where schemaname = 'public' and tablename = 'progress_logs';

  if v_count is distinct from 4 or v_fp is distinct from '14da1ff746e1ada87be5564254dd8f39' then
    raise exception 'progress_logs のポリシーが確認済みの状態と一致しません（件数 %, 指紋 %）。適用を中止します。',
      v_count, v_fp;
  end if;
end
$$;

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

-- トリガー関数は DML を行う利用者が直接呼ぶ必要がないため、どの利用者ロールにも実行権限を与えない。
revoke all on function rls_private.progress_logs_guard_identity() from public, anon, authenticated;

drop trigger if exists progress_logs_guard_identity_trg on public.progress_logs;
create trigger progress_logs_guard_identity_trg
  before update on public.progress_logs
  for each row execute function rls_private.progress_logs_guard_identity();

-- ---- 確認済みの既存ポリシー4本だけを削除する ----
drop policy if exists progress_logs_select on public.progress_logs;
drop policy if exists progress_logs_insert on public.progress_logs;
drop policy if exists progress_logs_update on public.progress_logs;
drop policy if exists progress_logs_delete on public.progress_logs;

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
