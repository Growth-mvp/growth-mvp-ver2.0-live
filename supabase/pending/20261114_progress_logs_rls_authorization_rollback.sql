-- ============================================================
-- 【切り戻し】20261114_progress_logs_rls_authorization.sql を適用前の状態に戻す。
-- 既存データは変更しない。1トランザクションで実行する。
--
-- 復元するポリシーは、本番の読み取り確認（2026-11-14、pg_policies をそのまま出力）から得た定義文である。
-- 適用直前に、確認SQLの「9」の出力と照合すること（本番が変わっていれば、その出力で DDL を作り直す）。
-- 最後に、ポリシーの指紋が確認済みの値（14da1ff746e1ada87be5564254dd8f39）と一致しなければ中止する。
-- ============================================================

begin;

-- 1. 修正案が作ったポリシーを外す
drop policy if exists progress_logs_select on public.progress_logs;
drop policy if exists progress_logs_insert on public.progress_logs;
drop policy if exists progress_logs_update on public.progress_logs;
drop policy if exists progress_logs_delete on public.progress_logs;

-- 2. 適用前の本番ポリシーを、確認時の定義文どおりに復元する
create policy progress_logs_delete on public.progress_logs as PERMISSIVE for DELETE to authenticated
  using ((EXISTS ( SELECT 1
   FROM company_members m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = progress_logs.company_id)))));
create policy progress_logs_insert on public.progress_logs as PERMISSIVE for INSERT to authenticated
  with check ((EXISTS ( SELECT 1
   FROM company_members m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = progress_logs.company_id)))));
create policy progress_logs_select on public.progress_logs as PERMISSIVE for SELECT to authenticated
  using ((EXISTS ( SELECT 1
   FROM company_members m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = progress_logs.company_id)))));
create policy progress_logs_update on public.progress_logs as PERMISSIVE for UPDATE to authenticated
  using ((EXISTS ( SELECT 1
   FROM company_members m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = progress_logs.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM company_members m
  WHERE ((m.user_id = auth.uid()) AND (m.company_id = progress_logs.company_id)))));

-- 3. 修正案の関数とトリガーを外す
drop trigger if exists progress_logs_guard_identity_trg on public.progress_logs;
drop function if exists rls_private.progress_logs_guard_identity();
drop function if exists rls_private.is_feedback(text);
drop function if exists rls_private.okr_in_company(uuid, uuid);
drop function if exists rls_private.is_admin(uuid);
drop function if exists rls_private.is_member(uuid);
drop schema if exists rls_private;

-- 4. 復元の確認（指紋が確認済みの値と一致しなければ、全体を取り消す）
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
    raise exception 'ポリシーが適用前の状態に戻りません（件数 %, 指紋 %）。切り戻しを取り消します。', v_count, v_fp;
  end if;
end
$$;

commit;
