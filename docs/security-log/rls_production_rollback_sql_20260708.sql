-- RLS Production Rollback SQL
-- Date: 2026-07-08
-- Purpose: Rollback RLS policies (DROP POLICY only)
-- Execution: Run in Supabase SQL Editor if apply SQL causes critical errors
-- Restrictions: Tables, data, and RLS status remain unchanged
-- Status: For rollback use only

BEGIN;

-- ==========================================
-- Drop all policies created by 20260708_add_rls_org_alignment_agent_logs.sql
-- ==========================================

-- org_alignment_insights policies
DROP POLICY IF EXISTS "insights_admin_crud" ON "public"."org_alignment_insights";
DROP POLICY IF EXISTS "insights_member_read" ON "public"."org_alignment_insights";

-- org_alignment_stage_reflection_candidates policies
DROP POLICY IF EXISTS "reflection_candidates_member_read" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_write" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_update" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_delete" ON "public"."org_alignment_stage_reflection_candidates";

-- org_alignment_insight_sources policies
DROP POLICY IF EXISTS "insight_sources_via_cases" ON "public"."org_alignment_insight_sources";

-- agent_logs policies
DROP POLICY IF EXISTS "agent_logs_admin_select" ON "public"."agent_logs";
DROP POLICY IF EXISTS "agent_logs_service_role_insert" ON "public"."agent_logs";

COMMIT;

-- ==========================================
-- Verification after rollback
-- ==========================================
-- After executing above DROP POLICY statements, verify with:
--
-- SELECT COUNT(*) FROM pg_policies
-- WHERE tablename IN (
--   'org_alignment_insights',
--   'org_alignment_stage_reflection_candidates',
--   'org_alignment_insight_sources',
--   'agent_logs'
-- );
--
-- Expected result: 0 (all policies removed)
-- Tables remain RLS-enabled with no policies defined
-- Pre-migration state restored
