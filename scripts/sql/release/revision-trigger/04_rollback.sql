SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_strategy_data_bump_revision ON public.strategy_data;

RESET lock_timeout;

SELECT t.tgname,
       t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'strategy_data'
  AND NOT t.tgisinternal
ORDER BY t.tgname;
