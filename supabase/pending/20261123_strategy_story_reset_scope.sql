-- ============================================================
-- 【未適用】全削除（管理画面）で strategy_data.story を空にできるようにする。
-- 本番DBへの適用は、別の承認の後に行う。適用前は全削除が story の段階で止まる（データは変わらない）。
--
-- 背景: trg_block_story_erase（guard_block_story_erase）は、story を非空から空配列へ上書きすると
--       元に戻し、story_versions に履歴を残す。自動保存の誤消去を防ぐための保護であり、維持する。
-- 変更: サービスロール（サーバーの全削除API）が、ヘッダ x-growth-reset-scope = company-business-data を
--       付けた場合だけ例外にする。利用者・自動保存・他のロールの動きは変えない。
-- 注意: PostgREST が request.jwt.claims / request.headers を設定する環境（Supabase）でのみ例外が成立する。
-- ============================================================

create or replace function public.guard_block_story_erase()
returns trigger
language plpgsql
set search_path = public
as $$
BEGIN
  -- 全削除API（サービスロール・明示ヘッダ）だけ、経営データの空化を許可する
  IF (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role') = 'service_role'
     AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-growth-reset-scope') = 'company-business-data'
  THEN
    RETURN NEW;
  END IF;

  -- 旧: 非空、 新: 空 → 上書き禁止（履歴に退避して元に戻す）
  IF NEW.story IS NOT NULL
     AND jsonb_typeof(NEW.story) = 'array'
     AND jsonb_array_length(NEW.story) = 0
     AND OLD.story IS NOT NULL
     AND jsonb_typeof(OLD.story) = 'array'
     AND jsonb_array_length(OLD.story) > 0
  THEN
    INSERT INTO public.story_versions(strategy_id, company_id, story_old, story_new, changed_by)
      VALUES (OLD.id, OLD.company_id, OLD.story, NEW.story, NEW.updated_by);

    -- 空配列での上書きを無効化（元の story に戻す）
    NEW.story := OLD.story;
  END IF;
  RETURN NEW;
END
$$;
