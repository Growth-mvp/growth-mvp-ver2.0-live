-- ============================================================
-- 20261123_strategy_story_reset_scope.sql の取り消し（元の guard_block_story_erase に戻す）
-- ============================================================

create or replace function public.guard_block_story_erase()
returns trigger
language plpgsql
set search_path = public
as $$
BEGIN
  -- 旧: 非空、 新: 空 → 上書き禁止（履歴に退避して元に戻す）
  IF NEW.story IS NOT NULL
     AND jsonb_typeof(NEW.story) = 'array'
     AND jsonb_array_length(NEW.story) = 0
     AND OLD.story IS NOT NULL
     AND jsonb_typeof(OLD.story) = 'array'
     AND jsonb_array_length(OLD.story) > 0
  THEN
    INSERT INTO public.story_versions(strategy_id, company_id, story_old, story_new, changed_by)
      -- ★ ここを OLD.strategy_id → OLD.id に変更
      VALUES (OLD.id, OLD.company_id, OLD.story, NEW.story, NEW.updated_by);

    -- 空配列での上書きを無効化（元の story に戻す）
    NEW.story := OLD.story;
  END IF;
  RETURN NEW;
END
$$;
