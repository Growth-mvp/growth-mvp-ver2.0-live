SET lock_timeout = '5s';

CREATE TRIGGER trg_strategy_data_bump_revision
  BEFORE UPDATE ON public.strategy_data
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_strategy_data_revision();

RESET lock_timeout;
