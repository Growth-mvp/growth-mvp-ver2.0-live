SELECT p.oid::regprocedure AS func,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'bump_strategy_data_revision';

SELECT t.tgname,
       t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'strategy_data'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT count(*) AS same_name_exists
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'strategy_data'
  AND t.tgname = 'trg_strategy_data_bump_revision';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'strategy_data'
  AND column_name = 'revision';

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'strategy_data'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE revision > 0) AS revision_positive_rows,
       max(revision) AS max_revision
FROM public.strategy_data;

SELECT pid, state, now() - query_start AS running_for
FROM pg_stat_activity
WHERE datname = current_database()
  AND query ILIKE '%strategy_data%'
  AND state <> 'idle'
ORDER BY query_start;
