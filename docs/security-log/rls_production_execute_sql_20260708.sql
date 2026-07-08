-- RLS Production Apply SQL
-- Date: 2026-07-08
-- Purpose: Apply RLS policies for org_alignment and agent_logs
-- Execution: Copy entire content to Supabase SQL Editor and Run
-- Status: NOT YET APPLIED

BEGIN;

-- ==========================================
-- 1. org_alignment_insights RLS Policies
-- ==========================================

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

DROP POLICY IF EXISTS "reflection_candidates_member_read" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_write" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_update" ON "public"."org_alignment_stage_reflection_candidates";
DROP POLICY IF EXISTS "reflection_candidates_admin_delete" ON "public"."org_alignment_stage_reflection_candidates";

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

DROP POLICY IF EXISTS "insight_sources_member_read" ON "public"."org_alignment_insight_sources";
DROP POLICY IF EXISTS "insight_sources_admin_insert" ON "public"."org_alignment_insight_sources";
DROP POLICY IF EXISTS "insight_sources_admin_update" ON "public"."org_alignment_insight_sources";
DROP POLICY IF EXISTS "insight_sources_admin_delete" ON "public"."org_alignment_insight_sources";

CREATE POLICY "insight_sources_member_read" ON "public"."org_alignment_insight_sources"
  FOR SELECT
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
  );

CREATE POLICY "insight_sources_admin_insert" ON "public"."org_alignment_insight_sources"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND "public"."fn_is_company_admin"("c"."company_id") = true
    )
  );

CREATE POLICY "insight_sources_admin_update" ON "public"."org_alignment_insight_sources"
  FOR UPDATE
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND "public"."fn_is_company_admin"("c"."company_id") = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND "public"."fn_is_company_admin"("c"."company_id") = true
    )
  );

CREATE POLICY "insight_sources_admin_delete" ON "public"."org_alignment_insight_sources"
  FOR DELETE
  TO "authenticated"
  USING (
    EXISTS (
      SELECT 1
      FROM "public"."org_alignment_cases" "c"
      WHERE "c"."id" = "public"."org_alignment_insight_sources"."case_id"
        AND "public"."fn_is_company_admin"("c"."company_id") = true
    )
  );

-- ==========================================
-- 4. agent_logs RLS Policies
-- ==========================================

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

CREATE POLICY "agent_logs_service_role_insert" ON "public"."agent_logs"
  FOR INSERT
  TO "service_role"
  WITH CHECK (true);

COMMIT;
