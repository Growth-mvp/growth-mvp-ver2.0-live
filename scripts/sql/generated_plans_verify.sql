-- ============================================================================
-- generated_plans 検証スクリプト（ステージング専用）
--
-- 実行方法:
--   ・ステージングの SQL エディタ、または psql で実行する。
--   ・必ず BEGIN ... ROLLBACK で囲む。途中で失敗しても何も残らない。
--   ・前提: auth.users に 3 件以上のユーザーがあること（uA / uB / uM として使う）。
--   ・本番DBでは実行しない。
--
-- 検証内容:
--   1) 書き込み時の整合チェックと不変性
--   2) 会社移動（計画書は移動・削除・NULL化されず、参照対象外になる）
--   3) RLS と権限（authenticated は SELECT のみ、anon は不可）
--   4) 会社移動の取り消し（旧会社に戻ると再び参照できる）
--
-- 注意: 同時保存とロック待ちは単一セッションでは検証できない（設計書 §検証 を参照）。
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- フィクスチャ
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _fx (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO _fx (name, id)
SELECT 'uA', id FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM auth.users) u WHERE rn = 1;
INSERT INTO _fx (name, id)
SELECT 'uB', id FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM auth.users) u WHERE rn = 2;
INSERT INTO _fx (name, id)
SELECT 'uM', id FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM auth.users) u WHERE rn = 3;

CREATE TEMP TABLE _ids (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO _ids VALUES
  ('cA', gen_random_uuid()),   -- 会社A（戦略あり、後に移動される）
  ('cC', gen_random_uuid()),   -- 会社C（移動先。戦略なし）
  ('sA', gen_random_uuid());   -- 戦略A（会社A所属）

GRANT SELECT ON _fx, _ids TO anon, authenticated;

INSERT INTO public.companies (id, name) SELECT id, 'verify-A' FROM _ids WHERE name = 'cA';
INSERT INTO public.companies (id, name) SELECT id, 'verify-C' FROM _ids WHERE name = 'cC';

INSERT INTO public.company_members (company_id, user_id, role)
SELECT (SELECT id FROM _ids WHERE name = 'cA'), (SELECT id FROM _fx WHERE name = 'uA'), 'admin';
INSERT INTO public.company_members (company_id, user_id, role)
SELECT (SELECT id FROM _ids WHERE name = 'cA'), (SELECT id FROM _fx WHERE name = 'uM'), 'member';
INSERT INTO public.company_members (company_id, user_id, role)
SELECT (SELECT id FROM _ids WHERE name = 'cC'), (SELECT id FROM _fx WHERE name = 'uB'), 'admin';

INSERT INTO public.strategy_data (id, company_id, user_id)
SELECT (SELECT id FROM _ids WHERE name = 'sA'), (SELECT id FROM _ids WHERE name = 'cA'), (SELECT id FROM _fx WHERE name = 'uA');

-- ---------------------------------------------------------------------------
-- 1) 書き込み時の整合チェックと不変性
-- ---------------------------------------------------------------------------
-- 1-1: 正常な INSERT（会社A・戦略A・bank）
INSERT INTO public.generated_plans (company_id, strategy_id, audience, generated_text, sections, generated_at, created_by, updated_by)
SELECT (SELECT id FROM _ids WHERE name = 'cA'), (SELECT id FROM _ids WHERE name = 'sA'), 'bank',
       '# 検証本文', '["検証本文"]'::jsonb, now(),
       (SELECT id FROM _fx WHERE name = 'uA'), (SELECT id FROM _fx WHERE name = 'uA');
DO $$ BEGIN RAISE NOTICE 'PASS 1-1: insert consistent plan'; END $$;

-- 1-2: 戦略と会社が一致しない INSERT は拒否（42501）
DO $$
BEGIN
  BEGIN
    INSERT INTO public.generated_plans (company_id, strategy_id, audience, generated_text, generated_at, created_by, updated_by)
    SELECT (SELECT id FROM _ids WHERE name = 'cC'), (SELECT id FROM _ids WHERE name = 'sA'), 'shareholder',
           'x', now(), (SELECT id FROM _fx WHERE name = 'uB'), (SELECT id FROM _fx WHERE name = 'uB');
    RAISE EXCEPTION 'TEST FAILED 1-2: mismatched insert was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 1-2: mismatched insert rejected';
  END;
END $$;

-- 1-3: audience の不正値は拒否（23514）
DO $$
BEGIN
  BEGIN
    INSERT INTO public.generated_plans (company_id, strategy_id, audience, generated_text, generated_at, created_by, updated_by)
    SELECT (SELECT id FROM _ids WHERE name = 'cA'), (SELECT id FROM _ids WHERE name = 'sA'), 'invalid',
           'x', now(), (SELECT id FROM _fx WHERE name = 'uA'), (SELECT id FROM _fx WHERE name = 'uA');
    RAISE EXCEPTION 'TEST FAILED 1-3: invalid audience was accepted';
  EXCEPTION WHEN sqlstate '23514' THEN
    RAISE NOTICE 'PASS 1-3: invalid audience rejected';
  END;
END $$;

-- 1-4: 本文更新で version が +1 される
UPDATE public.generated_plans SET generated_text = '# 検証本文 改'
WHERE company_id = (SELECT id FROM _ids WHERE name = 'cA') AND audience = 'bank';
DO $$
DECLARE v integer;
BEGIN
  SELECT version INTO v FROM public.generated_plans
  WHERE company_id = (SELECT id FROM _ids WHERE name = 'cA') AND audience = 'bank';
  IF v IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED 1-4: expected version 2, got %', v;
  END IF;
  RAISE NOTICE 'PASS 1-4: update increments version';
END $$;

-- 1-5: company_id の変更は拒否（42501）
DO $$
BEGIN
  BEGIN
    UPDATE public.generated_plans SET company_id = (SELECT id FROM _ids WHERE name = 'cC')
    WHERE audience = 'bank';
    RAISE EXCEPTION 'TEST FAILED 1-5: company_id change was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 1-5: company_id change rejected';
  END;
END $$;

-- 1-6: strategy_id の変更は拒否（42501）
DO $$
BEGIN
  BEGIN
    UPDATE public.generated_plans SET strategy_id = gen_random_uuid() WHERE audience = 'bank';
    RAISE EXCEPTION 'TEST FAILED 1-6: strategy_id change was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 1-6: strategy_id change rejected';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 会社移動（戦略 sA を会社A → 会社C）
-- ---------------------------------------------------------------------------
-- 2-1: 戦略の会社移動は成功する（既存の挙動が変わらないこと）
UPDATE public.strategy_data SET company_id = (SELECT id FROM _ids WHERE name = 'cC')
WHERE id = (SELECT id FROM _ids WHERE name = 'sA');
DO $$ BEGIN RAISE NOTICE 'PASS 2-1: strategy company move succeeds'; END $$;

-- 2-2: 計画書は移動・削除されていない（行数と company_id が変わらない）
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.generated_plans
  WHERE company_id = (SELECT id FROM _ids WHERE name = 'cA');
  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED 2-2: expected 1 plan kept under company A, got %', n;
  END IF;
  RAISE NOTICE 'PASS 2-2: plan not moved, deleted, or nulled';
END $$;

-- 2-3: 移動後、古い行を更新しようとすると拒否（戦略と会社が不一致）
DO $$
BEGIN
  BEGIN
    UPDATE public.generated_plans SET generated_text = '古い行の更新'
    WHERE company_id = (SELECT id FROM _ids WHERE name = 'cA');
    RAISE EXCEPTION 'TEST FAILED 2-3: stale row update was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 2-3: stale row update rejected';
  END;
END $$;

-- 2-4: 会社C は戦略 sA の計画書（会社A所属）を生成できる（新しい行）
INSERT INTO public.generated_plans (company_id, strategy_id, audience, generated_text, generated_at, created_by, updated_by)
SELECT (SELECT id FROM _ids WHERE name = 'cC'), (SELECT id FROM _ids WHERE name = 'sA'), 'bank',
       '# 会社Cの本文', now(), (SELECT id FROM _fx WHERE name = 'uB'), (SELECT id FROM _fx WHERE name = 'uB');
DO $$ BEGIN RAISE NOTICE 'PASS 2-4: company C can create its own plan for the moved strategy'; END $$;

-- ---------------------------------------------------------------------------
-- 3) RLS と権限
-- ---------------------------------------------------------------------------
-- 3-1: 旧会社A の admin は、移動後の計画書を参照できない（戦略の会社が一致しない）
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM _fx WHERE name = 'uA'))::text, true);
SELECT set_config('request.jwt.claim.sub', (SELECT id FROM _fx WHERE name = 'uA')::text, true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.generated_plans;
  IF n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED 3-1: company A admin sees % row(s) after move', n;
  END IF;
  RAISE NOTICE 'PASS 3-1: old company admin cannot read moved plan';
END $$;
RESET ROLE;

-- 3-2: 旧会社A の member も参照できない
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM _fx WHERE name = 'uM'))::text, true);
SELECT set_config('request.jwt.claim.sub', (SELECT id FROM _fx WHERE name = 'uM')::text, true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.generated_plans;
  IF n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED 3-2: company A member sees % row(s) after move', n;
  END IF;
  RAISE NOTICE 'PASS 3-2: old company member cannot read moved plan';
END $$;
RESET ROLE;

-- 3-3: 会社C の admin は、自社の計画書（bank 以外）のみ参照できる
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM _fx WHERE name = 'uB'))::text, true);
SELECT set_config('request.jwt.claim.sub', (SELECT id FROM _fx WHERE name = 'uB')::text, true);
DO $$
DECLARE n integer; a text;
BEGIN
  SELECT count(*), max(audience) INTO n, a FROM public.generated_plans;
  IF n <> 1 OR a <> 'bank' THEN
    RAISE EXCEPTION 'TEST FAILED 3-3: company C admin sees % row(s), audience=%', n, a;
  END IF;
  RAISE NOTICE 'PASS 3-3: company C sees only its own plan';
END $$;
RESET ROLE;

-- 3-4: authenticated は直接 INSERT できない（権限なし。42501）
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.generated_plans (company_id, strategy_id, audience, generated_text, generated_at, created_by, updated_by)
    SELECT (SELECT id FROM _ids WHERE name = 'cC'), (SELECT id FROM _ids WHERE name = 'sA'), 'employee',
           'x', now(), (SELECT id FROM _fx WHERE name = 'uB'), (SELECT id FROM _fx WHERE name = 'uB');
    RAISE EXCEPTION 'TEST FAILED 3-4: authenticated direct insert was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 3-4: authenticated direct insert denied';
  END;
  RESET ROLE;
END $$;

-- 3-5: anon は参照できない（権限なし。42501）
DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.generated_plans;
    RAISE EXCEPTION 'TEST FAILED 3-5: anon select was accepted';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE 'PASS 3-5: anon select denied';
  END;
  RESET ROLE;
END $$;

-- ---------------------------------------------------------------------------
-- 4) 会社移動の取り消し（戦略を会社Cから会社Aへ戻す）
-- ---------------------------------------------------------------------------
UPDATE public.strategy_data SET company_id = (SELECT id FROM _ids WHERE name = 'cA')
WHERE id = (SELECT id FROM _ids WHERE name = 'sA');

-- 4-1: 旧会社A の計画書が再び参照できる（生成日時で古さを判断できることが前提）
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM _fx WHERE name = 'uA'))::text, true);
SELECT set_config('request.jwt.claim.sub', (SELECT id FROM _fx WHERE name = 'uA')::text, true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.generated_plans WHERE company_id = (SELECT id FROM _ids WHERE name = 'cA');
  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED 4-1: expected 1 plan visible to A after move back, got %', n;
  END IF;
  RAISE NOTICE 'PASS 4-1: plan reappears after move back (generated_at is shown in UI)';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5) 冪等性: 検証で作った関数・トリガーの再作成が安全であること
--    （マイグレーション本体を別途、二回連続で実行して確認する）
-- ---------------------------------------------------------------------------
DO $$ BEGIN RAISE NOTICE 'ALL CHECKS COMPLETED (transaction will be rolled back)'; END $$;

ROLLBACK;
