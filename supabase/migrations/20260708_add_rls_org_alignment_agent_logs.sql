-- Migration: Add RLS policies for org_alignment and agent_logs
-- Date: 2026-07-08
-- Purpose: Enforce tenant isolation at database level for org_alignment and agent_logs tables
-- Status: NOT YET APPLIED TO PRODUCTION
-- Apply with: supabase migration up --linked (after testing locally)

-- ==========================================
-- 1. org_alignment_insights RLS Policies
-- ==========================================
-- Table: org_alignment_insights
-- Current: RLS enabled, NO policies defined
-- Risk: All authenticated users can access all rows
-- Fix: Add admin CRUD + member read policies

DROP POLICY IF EXISTS "insights_admin_crud" ON "public"."org_alignment_insights";
DROP POLICY IF EXISTS "insights_member_read" ON "public"."org_alignment_insights";

CREATE POLICY "insights_admin_crud" ON "public"."org_alignment_insights"
  TO "authenticated"
  USING (
    "public"."fn_is_company_admin"("company_id") = true
  )
  WITH CHECK (
    "public"."fn_is_company_admin"("company_id") = true
  );

CREATE POLICY "insights_member_read" ON "public"."org_alignment_insights"
  FOR SELECT
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."company_members" "m"
      WHERE "m"."company_id" = "public"."org_alignment_insights"."company_id"
        AND "m"."user_id" = "auth"."uid"()
    )
  );

-- ==========================================
-- 2. org_alignment_stage_reflection_candidates RLS Policies
-- ==========================================
-- Table: org_alignment_stage_reflection_candidates
-- Current: RLS enabled, NO policies defined
-- Risk: All authenticated users can access all rows
-- Fix: Add member read + admin write policies

DROP POLICY IF EXISTS "reflection_candidates_member_read" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_write" ON "public"."org_alignment_stage_reflection_candidates";

CREATE POLICY "reflection_candidates_member_read" ON "public"."org_alignment_stage_reflection_candidates"
  FOR SELECT
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."company_members" "m"
      WHERE "m"."company_id" = "public"."org_alignment_stage_reflection_candidates"."company_id"
        AND "m"."user_id" = "auth"."uid"()
    )
  );

CREATE POLICY "reflection_candidates_admin_write" ON "public"."org_alignment_stage_reflection_candidates"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (
    "public"."fn_is_company_admin"("company_id") = true
  );

CREATE POLICY "reflection_candidates_admin_update" ON "public"."org_alignment_stage_reflection_candidates"
  FOR UPDATE
  TO "authenticated"
  USING (
    "public"."fn_is_company_admin"("company_id") = true
  )
  WITH CHECK (
    "public"."fn_is_company_admin"("company_id") = true
  );

CREATE POLICY "reflection_candidates_admin_delete" ON "public"."org_alignment_stage_reflection_candidates"
  FOR DELETE
  TO "authenticated"
  USING (
    "public"."fn_is_company_admin"("company_id") = true
  );

-- ==========================================
-- 3. org_alignment_insight_sources RLS Policies
-- ==========================================
-- Table: org_alignment_insight_sources
-- Current: RLS enabled, NO policies defined
-- Risk: All authenticated users can access all rows
-- Special: NO company_id column (only insight_id and case_id)
-- Design Note: Relies on org_alignment_cases RLS to prevent cross-company access
--             Insight_sources acts as N-to-N junction, inherits security from cases

DROP POLICY IF EXISTS "insight_sources_via_cases" ON "public"."org_alignment_insight_sources";

CREATE POLICY "insight_sources_via_cases" ON "public"."org_alignment_insight_sources"
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND EXISTS (
          SELECT 1
          FROM "public"."company_members" "m"
          WHERE "m"."company_id" = "c"."company_id"
            AND "m"."user_id" = "auth"."uid"()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND EXISTS (
          SELECT 1
          FROM "public"."company_members" "m"
          WHERE "m"."company_id" = "c"."company_id"
            AND "m"."user_id" = "auth"."uid"()
        )
    )
  );

-- ==========================================
-- 4. agent_logs RLS Policies
-- ==========================================
-- Table: agent_logs
-- Current: RLS enabled, NO policies defined
-- Risk: All authenticated users can access all logs
-- Special: NO company_id column (only user_id and strategy_id)
-- Design Decision: Prevent public SELECT (admin only), allow service_role INSERT
--                 strategy_id links to strategy_data which has company_id

DROP POLICY IF EXISTS "agent_logs_admin_select" ON "public"."agent_logs";
DROP POLICY IF EXISTS "agent_logs_service_role_insert" ON "public"."agent_logs";

CREATE POLICY "agent_logs_admin_select" ON "public"."agent_logs"
  FOR SELECT
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."strategy_data" "s"
      WHERE "s"."id" = "public"."agent_logs"."strategy_id"
        AND "public"."fn_is_company_admin"("s"."company_id") = true
    )
  );

-- Allow service_role to INSERT logs (no RLS restriction)
-- This allows backend/trigger to log without RLS enforcement
CREATE POLICY "agent_logs_service_insert" ON "public"."agent_logs"
  FOR INSERT
  TO "service_role"
  WITH CHECK (true);

-- ==========================================
-- Notes for Review
-- ==========================================
-- 1. org_alignment_insight_sources: Relies on case_id FK to enforce company isolation
--    - Each insight_source references a case
--    - Each case has company_id and its own RLS
--    - This N-to-N junction inherits company security from cases
--
-- 2. agent_logs: Relies on strategy_id FK to enforce company isolation
--    - Each log references a strategy
--    - Each strategy has company_id and RLS
--    - Admin can view logs for their strategies via strategy's company_id
--    - Service role can always INSERT (for backend logging)
--
-- 3. Helper functions used:
--    - fn_is_company_admin(c_id) - checks if current user is admin of company
--    - Defined in schema at lines 74-92
--
-- 4. Test plan: See rls_org_alignment_agent_logs_test_plan_20260708.md
--
-- 5. Impact analysis: See rls_p0_fix_plan_20260708.md
