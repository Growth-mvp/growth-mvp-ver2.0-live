-- ============================================================
-- 本番の読み取り専用確認（SELECT のみ。データ・ポリシー・関数は変更しない）
-- 実行場所: Supabase ダッシュボードの SQL Editor（本番プロジェクト）
-- 本文（progress_logs.content）は取得しない。件数と定義だけを返す。
-- 結果は適用前の記録として保存する（8 の出力が、切り戻しの元になる）。
-- ============================================================

-- 1. 現在の progress_logs のポリシー（許可ポリシーが残っていないか）
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'progress_logs'
order by policyname;

-- 2. RLS の有効・強制、トリガー一覧
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.progress_logs'::regclass;

select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.progress_logs'::regclass and not tgisinternal
order by tgname;

-- 3. progress_logs の列構造（department_id / project_id の有無）
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'progress_logs'
order by ordinal_position;

-- 4. 既存の権限判定関数の定義と実行権限（SECURITY DEFINER・PUBLIC・anon への付与）
select n.nspname as schema, p.proname as name, p.prosecdef as security_definer,
       pg_get_userbyid(p.proowner) as owner, p.proacl as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'rls_private')
  and p.proname in ('is_company_member', 'is_company_admin', 'fn_is_company_admin', 'fn_company_role',
                    'fn_same_company_user', 'has_edit_role', 'is_member', 'is_admin', 'okr_in_company',
                    'is_feedback', 'progress_logs_guard_identity')
order by n.nspname, p.proname;

-- 5. 所属の役割別件数（全社。所属者の氏名などは出さない）
select role, count(*) as memberships from public.company_members group by role order by role;

-- 6. 管理者フィードバック（本文が [FB] で始まる行）の作成者の役割別件数
--    判定は修正案と同じ正規表現。作成時点の所属で役割を見る。
select coalesce(m.role, '所属なし') as author_role, count(*) as feedback_rows
from public.progress_logs p
left join public.company_members m
  on m.company_id = p.company_id and m.user_id = p.user_id
where p.content ~ '^(__META__:[^\n]*\n)?\[FB\]'
group by 1 order by 1;

-- 7. 既存の不整合（件数のみ）
select
  (select count(*) from public.progress_logs) as progress_logs_total,
  (select count(*) from public.progress_logs where okr_id is null) as okr_id_null,
  (select count(*) from public.progress_logs p
     where not exists (select 1 from public.okrs o where o.id = p.okr_id and o.company_id = p.company_id)) as okr_not_in_same_company,
  (select count(*) from public.progress_logs p
     where not exists (select 1 from public.company_members m where m.company_id = p.company_id and m.user_id = p.user_id)) as author_not_member;

-- 8. 切り戻し用：現在の progress_logs ポリシーを CREATE POLICY 文として出す（修正案を適用する前に保存する）
select format(
  'create policy %I on public.progress_logs as %s for %s to %s%s%s;',
  policyname, permissive, cmd, array_to_string(roles, ', '),
  case when qual is not null then format(' using (%s)', qual) else '' end,
  case when with_check is not null then format(' with check (%s)', with_check) else '' end
) as restore_ddl
from pg_policies
where schemaname = 'public' and tablename = 'progress_logs'
order by policyname;

-- 9. 修正案の適用先に、既に同名の非公開スキーマや関数があるか
select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'rls_private';

-- 10. 関連する関数の定義（SECURITY DEFINER の判定関数と、company_members・progress_logs を参照する関数）
--     定義文はコードであり、業務データは含まない。
select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, p.provolatile as volatility, pg_get_userbyid(p.proowner) as owner,
       p.proacl as acl, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'rls_private')
  and (p.prosecdef
       or p.prosrc ilike '%progress_logs%'
       or p.prosrc ilike '%company_members%')
order by 1, 2;

-- 11. 現在の progress_logs ポリシーの指紋（修正案が前提とする状態と一致するかの確認用）
--     名前・種別・対象ロール・式だけを連結して md5 を取る。本文は含まない。
select count(*) as policy_count,
       md5(string_agg(concat_ws('|', policyname, permissive, cmd, array_to_string(roles, ','),
                                coalesce(qual, ''), coalesce(with_check, '')),
                      E'\n' order by policyname)) as policy_fingerprint
from pg_policies
where schemaname = 'public' and tablename = 'progress_logs';
