-- RLS Production Verify SQL
-- Date: 2026-07-08
-- Purpose: Verify RLS policies were created correctly
-- Execution: Run in Supabase SQL Editor after apply SQL
-- Output: Metadata only (no actual data)

-- ==========================================
-- 1. Verify all policies were created (count)
-- ==========================================

SELECT
  COUNT(*) as total_policy_count
FROM pg_policies
WHERE tablename IN (
  'org_alignment_insights',
  'org_alignment_stage_reflection_candidates',
  'org_alignment_insight_sources',
  'agent_logs'
);

-- Expected result: 12 policies created
-- (2 + 4 + 4 + 2 = 12)


-- ==========================================
-- 2. Verify policies by table
-- ==========================================

SELECT
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN (
  'org_alignment_insights',
  'org_alignment_stage_reflection_candidates',
  'org_alignment_insight_sources',
  'agent_logs'
)
ORDER BY tablename, policyname;

-- Expected result:
-- org_alignment_insights: 2 policies
--   - insights_admin_crud
--   - insights_member_read
-- org_alignment_stage_reflection_candidates: 4 policies
--   - reflection_candidates_member_read
--   - reflection_candidates_admin_write
--   - reflection_candidates_admin_update
--   - reflection_candidates_admin_delete
-- org_alignment_insight_sources: 4 policies
--   - insight_sources_member_read
--   - insight_sources_admin_insert
--   - insight_sources_admin_update
--   - insight_sources_admin_delete
-- agent_logs: 2 policies
--   - agent_logs_admin_select
--   - agent_logs_service_role_insert


-- ==========================================
-- 3. Verify RLS is enabled on target tables
-- ==========================================

SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN (
  'org_alignment_insights',
  'org_alignment_stage_reflection_candidates',
  'org_alignment_insight_sources',
  'agent_logs'
)
ORDER BY tablename;

-- Expected result: All 4 tables have rls_enabled = true


-- ==========================================
-- 4. Verify helper functions exist
-- ==========================================

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name IN (
  'fn_is_company_admin',
  'fn_company_role'
)
AND routine_schema = 'public'
ORDER BY routine_name;

-- Expected result: Both functions exist
--   - fn_is_company_admin (FUNCTION)
--   - fn_company_role (FUNCTION)


-- ==========================================
-- 5. Quick policy summary
-- ==========================================

SELECT
  'org_alignment_insights' as table_name,
  2 as expected_policy_count,
  (SELECT COUNT(*) FROM pg_policies
   WHERE tablename = 'org_alignment_insights') as actual_count

UNION ALL

SELECT
  'org_alignment_stage_reflection_candidates',
  4,
  (SELECT COUNT(*) FROM pg_policies
   WHERE tablename = 'org_alignment_stage_reflection_candidates')

UNION ALL

SELECT
  'org_alignment_insight_sources',
  1,
  (SELECT COUNT(*) FROM pg_policies
   WHERE tablename = 'org_alignment_insight_sources')

UNION ALL

SELECT
  'agent_logs',
  2,
  (SELECT COUNT(*) FROM pg_policies
   WHERE tablename = 'agent_logs')

ORDER BY table_name;

-- Expected result: All actual_count match expected_policy_count
