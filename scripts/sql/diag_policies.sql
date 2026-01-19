-- ★ E) RLS ポリシー診断スクリプト
-- 実行方法: Supabase SQL Editor で実行
-- 目的: strategy_data table の RLS ポリシー確認

-- 1) strategy_data テーブルの RLS 有効化状態
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'strategy_data'
ORDER BY tablename;

-- 2) strategy_data テーブルに適用されている RLS ポリシー一覧
SELECT
  policyname,
  tablename,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;

-- 3) company_members テーブルの構造確認
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'company_members'
ORDER BY ordinal_position;

-- 4) 直近のエラー/ポリシー違反ログ（Supabase Functions内で記録されている場合）
-- Note: Supabase でのログ確認は管理画面 → Logs を確認すること
