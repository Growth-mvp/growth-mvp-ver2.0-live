-- ============================================================================
-- Migration (DRAFT / 未適用): generated_plans  [v6]
-- 経営計画書の保存。(company_id, strategy_id, audience) ごとに最新1件。
--
-- 方針:
--  - 既存テーブル（strategy_data 等）・既存トリガー・既存関数・既存データには変更を加えない。
--    （新規に参照するだけ。既存の制約・権限・ポリシーは変更しない）
--  - 会社移動時は計画書を移動・削除・NULL化しない。読み取り時に
--    計画書の company_id と戦略の現在の company_id を照合して参照可否を決める（API と RLS の両方）。
--  - 書き込みは API（service_role）のみ。authenticated には SELECT のみ付与。
--  - 戦略との整合は書き込み時にトリガーで検査する。
--
-- 適用ルール:
--  - 本番Supabaseへの適用は承認後のみ。
--  - 全体を1つのトランザクションで実行する。途中でエラーが起きた場合は全体がロールバックされ、
--    テーブル・ポリシー・権限は1つも残らない。
--  - ロック待ちは 5 秒で打ち切る（既存の戦略保存を長時間止めないため）。
--  - 再実行可能（IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE）。
--  - トリガーは全ロール（service_role を含む）に適用される。
--
-- 権限の前提（Supabase の既定権限との整合）:
--  - Supabase は public スキーマの新規テーブルに、既定で anon / authenticated / service_role への
--    権限を付与する設定（ALTER DEFAULT PRIVILEGES）を持つことがある。
--  - 本マイグレーションは作成直後に PUBLIC / anon / authenticated の権限をすべて取り消し、
--    必要最小限だけを付与し直す。適用前に pg_default_acl を読み取り専用で確認すること（FINAL_DESIGN_REVIEW.md）。
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';


-- ----------------------------------------------------------------------------
-- Step 1: テーブル（作成直後に RLS 有効化と権限の取り消し）
--   外部キーは既存テーブルへの参照のみ。ON UPDATE の動作は持たせない（既存の戦略更新に影響させないため）。
--   CREATE TABLE ... REFERENCES は参照先に SHARE ROW EXCLUSIVE ロックを短時間取る。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_plans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies (id),
  strategy_id     uuid        NOT NULL REFERENCES public.strategy_data (id) ON DELETE CASCADE,
  audience        text        NOT NULL,
  generated_text  text        NOT NULL,
  sections        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  generated_at    timestamptz NOT NULL,
  version         integer     NOT NULL DEFAULT 1,
  created_by      uuid        NOT NULL,
  updated_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generated_plans_scope_key
    UNIQUE (company_id, strategy_id, audience),
  CONSTRAINT generated_plans_audience_check
    CHECK (audience IN ('bank', 'shareholder', 'employee')),
  CONSTRAINT generated_plans_text_length_check
    CHECK (char_length(generated_text) BETWEEN 1 AND 200000),
  CONSTRAINT generated_plans_version_check
    CHECK (version >= 1)
);

ALTER TABLE public.generated_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.generated_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.generated_plans TO authenticated;
GRANT ALL ON public.generated_plans TO service_role;

CREATE INDEX IF NOT EXISTS generated_plans_strategy_idx
  ON public.generated_plans (strategy_id);

COMMENT ON TABLE public.generated_plans IS
  '経営計画書（会社・戦略・対象者ごとに最新1件）。書き込みはAPI経由のみ。'
  '戦略の現在の会社と company_id が一致する行だけを参照対象とする。';


-- ----------------------------------------------------------------------------
-- Step 2: ガードトリガー（INSERT / UPDATE）
--   a) 識別子（id / company_id / strategy_id / audience / created_at / created_by）は UPDATE で変更不可。
--   b) 書き込み時に strategy_data の現在の company_id と一致することを検査する。
--      FOR KEY SHARE を使う理由: 会社移動の UPDATE（company_id は一意インデックスの列のため FOR UPDATE を取る）とは衝突して
--      移動を待たせるが、通常の戦略保存（FOR NO KEY UPDATE を取る）とは衝突しない。
--   c) UPDATE 時は version を +1、updated_at を更新する。
--   d) 一致しない戦略への書き込み（古い行の更新を含む）は 42501 で拒否する。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generated_plans_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.strategy_id IS DISTINCT FROM OLD.strategy_id
    OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'generated_plans: identity columns are immutable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.strategy_data s
  WHERE s.id = NEW.strategy_id
    AND s.company_id = NEW.company_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'generated_plans: strategy does not belong to the company'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.generated_plans_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_generated_plans_guard ON public.generated_plans;
CREATE TRIGGER trg_generated_plans_guard
  BEFORE INSERT OR UPDATE ON public.generated_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.generated_plans_guard();


-- ----------------------------------------------------------------------------
-- Step 3: RLS（読み取りのみ。書き込みポリシーは持たせない）
--   参照条件: 所属していること AND 戦略の現在の会社が計画書の会社と一致すること。
--   会社移動後は、旧会社・新会社のどちらからも参照されない。
--   is_company_member() は既存の SECURITY DEFINER 関数。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS generated_plans_select ON public.generated_plans;
CREATE POLICY generated_plans_select
  ON public.generated_plans
  FOR SELECT
  TO authenticated
  USING (
    public.is_company_member(company_id, ARRAY['admin', 'manager', 'member']::text[])
    AND EXISTS (
      SELECT 1
      FROM public.strategy_data s
      WHERE s.id = generated_plans.strategy_id
        AND s.company_id = generated_plans.company_id
    )
  );


-- ----------------------------------------------------------------------------
-- ロールバック（本番適用後に問題が出た場合のみ。承認後に実行）
--   DROP TABLE IF EXISTS public.generated_plans;
--   DROP FUNCTION IF EXISTS public.generated_plans_guard();
-- ----------------------------------------------------------------------------

COMMIT;
