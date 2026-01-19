-- ★ E) データ存在性・権限診断スクリプト
-- 実行方法: Supabase SQL Editor で実行（認証なしで、RLS ポリシーが許可していない限り動作しません）
-- 目的: strategy_data と company_members の関連性確認

-- 1) テスト会社ID (e0f342d6-f172-434b-bf9e-9195444bf3b8) のデータ確認
SELECT
  id,
  company_id,
  revision,
  created_at,
  updated_at,
  json_object_keys(COALESCE(csv_finance_data::jsonb, '{}'::jsonb)) as csv_finance_data_keys,
  json_object_keys(COALESCE(finance_pl::jsonb, '[]'::jsonb)) as finance_pl_keys
FROM strategy_data
WHERE company_id = 'e0f342d6-f172-434b-bf9e-9195444bf3b8'
ORDER BY updated_at DESC;

-- 2) テスト会社 (e0f342d6-f172-434b-bf9e-9195444bf3b8) のメンバーシップ確認
SELECT
  user_id,
  company_id,
  role,
  created_at,
  updated_at
FROM company_members
WHERE company_id = 'e0f342d6-f172-434b-bf9e-9195444bf3b8'
ORDER BY created_at;

-- 3) テストユーザー (9bb99a79-5259-42e1-8f59-f54acdce97c0) の所属会社一覧
SELECT
  company_id,
  role,
  created_at,
  updated_at
FROM company_members
WHERE user_id = '9bb99a79-5259-42e1-8f59-f54acdce97c0'
ORDER BY created_at;

-- 4) auth.users テーブル内のテストユーザー存在確認（auth.uid() と一致するか）
-- Note: auth.users は通常、管理ユーザーのみがアクセス可能
SELECT
  id,
  email,
  created_at,
  last_sign_in_at
FROM auth.users
WHERE id = '9bb99a79-5259-42e1-8f59-f54acdce97c0';

-- 5) メンバーシップのないデータ行確認（オーファン行）
SELECT
  sd.id,
  sd.company_id,
  sd.revision,
  CASE WHEN cm.company_id IS NULL THEN 'NO_MEMBER' ELSE 'OK' END as membership_status
FROM strategy_data sd
LEFT JOIN (
  SELECT DISTINCT company_id FROM company_members WHERE user_id = '9bb99a79-5259-42e1-8f59-f54acdce97c0'
) cm ON sd.company_id = cm.company_id
WHERE sd.company_id IN (
  SELECT company_id FROM company_members WHERE user_id = '9bb99a79-5259-42e1-8f59-f54acdce97c0'
)
LIMIT 10;
