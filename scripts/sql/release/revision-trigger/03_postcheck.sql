SELECT t.tgname,
       t.tgenabled,
       (t.tgtype & 1) <> 0  AS row_level,
       (t.tgtype & 2) <> 0  AS before_trigger,
       (t.tgtype & 16) <> 0 AS on_update,
       p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'strategy_data'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

SELECT md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'bump_strategy_data_revision';
