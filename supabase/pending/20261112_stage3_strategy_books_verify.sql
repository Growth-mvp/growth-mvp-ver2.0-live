-- ============================================================
-- 新STAGE3用SQL（20261112_stage3_strategy_books.sql）の適用前後の確認。SELECT のみで、データもスキーマも変更しない。
-- 手順: 1) 本番適用の前に【A】を実行し、結果を控える。 2) 本体SQLを適用する。 3) 【B】を実行し、【A】の値と比べる。
-- ============================================================

-- 【A】適用前に実行（記録用）
select
  to_regclass('public.stage3_strategy_books') is null as table_absent_before,
  (select count(*) from pg_tables where schemaname = 'public') as public_table_count,
  (select count(*) from public.strategy_data) as strategy_rows,
  (select max(revision) from public.strategy_data) as max_revision,
  md5(pg_get_functiondef('public.bump_strategy_data_revision()'::regprocedure)) as revision_fn_md5;

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.strategy_data'::regclass and not t.tgisinternal
order by t.tgname;

-- 【B】適用後に実行（確認用）
select
  to_regclass('public.stage3_strategy_books') is not null as table_exists,
  (select relrowsecurity from pg_class where oid = 'public.stage3_strategy_books'::regclass) as rls_enabled,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'stage3_strategy_books') as policy_count,
  (select count(*) from pg_trigger where tgrelid = 'public.stage3_strategy_books'::regclass and not tgisinternal and tgenabled <> 'D') as scope_trigger_count,
  to_regprocedure('public.stage3_confirm_strategy_book(uuid,uuid,uuid,integer,integer,jsonb,jsonb)') is not null as confirm_fn_exists,
  (select count(*) from pg_tables where schemaname = 'public') as public_table_count;

select policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename = 'stage3_strategy_books';

select r.rolname,
  has_table_privilege(r.rolname, 'public.stage3_strategy_books', 'SELECT') as sel,
  has_table_privilege(r.rolname, 'public.stage3_strategy_books', 'INSERT') as ins,
  has_table_privilege(r.rolname, 'public.stage3_strategy_books', 'UPDATE') as upd,
  has_table_privilege(r.rolname, 'public.stage3_strategy_books', 'DELETE') as del,
  has_table_privilege(r.rolname, 'public.stage3_strategy_books', 'TRUNCATE') as trunc
from (values ('anon'), ('authenticated'), ('service_role')) r(rolname);

select r.rolname,
  has_function_privilege(r.rolname, 'public.stage3_confirm_strategy_book(uuid,uuid,uuid,integer,integer,jsonb,jsonb)', 'EXECUTE') as can_execute
from (values ('anon'), ('authenticated'), ('service_role')) r(rolname);

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = 'public.strategy_data'::regclass and not t.tgisinternal
order by t.tgname;

select md5(pg_get_functiondef('public.bump_strategy_data_revision()'::regprocedure)) as revision_fn_md5;

select count(*) as stage3_rows from public.stage3_strategy_books;

select
  (select count(*) from public.strategy_data) as strategy_rows,
  (select max(revision) from public.strategy_data) as max_revision;
