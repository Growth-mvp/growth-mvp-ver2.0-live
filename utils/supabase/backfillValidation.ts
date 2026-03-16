// /utils/supabase/backfillValidation.ts
'use client';

/**
 * Validation queries for Phase 2A-3 backfill
 *
 * These queries validate data integrity before and after backfill
 * Corresponds to PHASE_2A_SUPABASE_MIGRATION.sql STEP 6
 */

import { supabase } from './client';

/* =========================================================
 * Query A: Backfill target count (with id requirements)
 * ========================================================= */

/**
 * Count OKRs that meet backfill criteria:
 * - department.id exists
 * - project.id exists
 * - objective exists
 */
export async function queryA(): Promise<{
  backfill_okr_count: number;
  strategy_count: number;
  department_with_id_count: number;
  project_with_id_count: number;
}> {
  const sql = `
SELECT
  COUNT(*) as backfill_okr_count,
  COUNT(DISTINCT sd.id) as strategy_count,
  COUNT(DISTINCT (dept->>'id')) as department_with_id_count,
  COUNT(DISTINCT (proj->>'id')) as project_with_id_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE sd.company_id IS NOT NULL
  AND okr->>'objective' IS NOT NULL
  AND (dept->>'id') IS NOT NULL
  AND (proj->>'id') IS NOT NULL;
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
  });

  if (error) {
    console.error('[queryA] Error:', error);
    throw error;
  }

  return data?.[0] || {
    backfill_okr_count: 0,
    strategy_count: 0,
    department_with_id_count: 0,
    project_with_id_count: 0,
  };
}

/* =========================================================
 * Query A2: Skip count (missing ids)
 * ========================================================= */

/**
 * Count OKRs that will be skipped due to missing ids
 */
export async function queryA2(): Promise<{
  skipped_okr_count: number;
  no_department_id: number;
  no_project_id: number;
}> {
  const sql = `
SELECT
  COUNT(*) as skipped_okr_count,
  SUM(CASE WHEN (dept->>'id') IS NULL THEN 1 ELSE 0 END) as no_department_id,
  SUM(CASE WHEN (proj->>'id') IS NULL THEN 1 ELSE 0 END) as no_project_id
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj,
     jsonb_array_elements(COALESCE(proj->'okrs', '[]'::jsonb)) okr
WHERE sd.company_id IS NOT NULL
  AND okr->>'objective' IS NOT NULL
  AND ((dept->>'id') IS NULL OR (proj->>'id') IS NULL);
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
  });

  if (error) {
    console.error('[queryA2] Error:', error);
    throw error;
  }

  return data?.[0] || {
    skipped_okr_count: 0,
    no_department_id: 0,
    no_project_id: 0,
  };
}

/* =========================================================
 * Query B2: okrsV2-only projects (no auto-migration)
 * ========================================================= */

/**
 * Count projects that have okrsV2 but no okrs
 * (These are NOT auto-migrated in Phase 2A-3)
 */
export async function queryB2(): Promise<{
  okrsV2_only_project_count: number;
  total_okrsV2_count: number;
}> {
  const sql = `
SELECT
  COUNT(DISTINCT (proj->>'id')) as okrsV2_only_project_count,
  SUM(jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb))) as total_okrsV2_count
FROM strategy_data sd,
     jsonb_array_elements(sd.departments) dept,
     jsonb_array_elements(COALESCE(dept->'projects', '[]'::jsonb)) proj
WHERE (proj->>'id') IS NOT NULL
  AND jsonb_array_length(COALESCE(proj->'okrs', '[]'::jsonb)) = 0
  AND jsonb_array_length(COALESCE(proj->'okrsV2', '[]'::jsonb)) > 0;
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
  });

  if (error) {
    console.error('[queryB2] Error:', error);
    throw error;
  }

  return data?.[0] || {
    okrsV2_only_project_count: 0,
    total_okrsV2_count: 0,
  };
}

/* =========================================================
 * Query C: okrs table count (post-backfill verification)
 * ========================================================= */

/**
 * Verify okrs table has correct number of records after backfill
 */
export async function queryC(): Promise<{
  okrs_table_count: number;
  strategy_count: number;
  department_count: number;
  active_okr_count: number;
}> {
  const { data, error } = await supabase
    .from('okrs')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false);

  if (error) {
    console.error('[queryC] Error:', error);
    throw error;
  }

  // Get distinct counts via separate queries
  const { data: strategies } = await supabase
    .from('okrs')
    .select('strategy_id')
    .eq('is_deleted', false);

  const { data: departments } = await supabase
    .from('okrs')
    .select('department_id')
    .eq('is_deleted', false);

  const distinctStrategies = new Set(strategies?.map((r) => r.strategy_id) || []);
  const distinctDepartments = new Set(departments?.map((r) => r.department_id) || []);

  return {
    okrs_table_count: data?.length || 0,
    strategy_count: distinctStrategies.size,
    department_count: distinctDepartments.size,
    active_okr_count: data?.length || 0,
  };
}

/* =========================================================
 * Query D: RLS verification
 * ========================================================= */

/**
 * Verify RLS is enabled on okrs table
 */
export async function queryD(): Promise<{
  tablename: string;
  rls_enabled: boolean;
}[]> {
  const sql = `
SELECT
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'okrs';
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
  });

  if (error) {
    console.error('[queryD] Error:', error);
    return [];
  }

  return data || [];
}

/* =========================================================
 * Query E: Index verification
 * ========================================================= */

/**
 * Verify indexes are created on okrs table
 */
export async function queryE(): Promise<
  Array<{
    indexname: string;
    tablename: string;
  }>
> {
  const sql = `
SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE tablename = 'okrs'
ORDER BY indexname;
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    query: sql,
  });

  if (error) {
    console.error('[queryE] Error:', error);
    return [];
  }

  return data || [];
}

/* =========================================================
 * Query F: Soft delete verification
 * ========================================================= */

/**
 * Verify soft delete is working (deleted OKRs are not returned)
 */
export async function queryF(companyId: string): Promise<
  Array<{
    id: string;
    objective: string;
    is_deleted: boolean;
  }>
> {
  const { data, error } = await supabase
    .from('okrs')
    .select('id, objective, is_deleted')
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('[queryF] Error:', error);
    return [];
  }

  return data || [];
}

/* =========================================================
 * Query G: Deleted OKR count
 * ========================================================= */

/**
 * Count how many OKRs are soft-deleted
 */
export async function queryG(): Promise<{
  deleted_okr_count: number;
}> {
  const { count, error } = await supabase
    .from('okrs')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', true);

  if (error) {
    console.error('[queryG] Error:', error);
    return { deleted_okr_count: 0 };
  }

  return { deleted_okr_count: count || 0 };
}

/* =========================================================
 * Comprehensive validation
 * ========================================================= */

export interface ValidationResult {
  timestamp: string;
  queries: {
    queryA?: {
      backfill_okr_count: number;
      strategy_count: number;
      department_with_id_count: number;
      project_with_id_count: number;
    };
    queryA2?: {
      skipped_okr_count: number;
      no_department_id: number;
      no_project_id: number;
    };
    queryB2?: {
      okrsV2_only_project_count: number;
      total_okrsV2_count: number;
    };
    queryC?: {
      okrs_table_count: number;
      strategy_count: number;
      department_count: number;
      active_okr_count: number;
    };
    queryD?: any[];
    queryE?: any[];
  };
  summary: {
    readyForBackfill: boolean;
    issues: string[];
  };
}

/**
 * Run all validation queries and summarize results
 */
export async function runAllValidationQueries(): Promise<ValidationResult> {
  const result: ValidationResult = {
    timestamp: new Date().toISOString(),
    queries: {},
    summary: {
      readyForBackfill: true,
      issues: [],
    },
  };

  try {
    console.log('[Validation] Running all validation queries...');

    // Query A
    try {
      result.queries.queryA = await queryA();
      console.log('[Validation] Query A (backfill target count):', result.queries.queryA);
    } catch (err) {
      console.error('[Validation] Query A failed:', err);
      result.summary.issues.push(`Query A failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Query A2
    try {
      result.queries.queryA2 = await queryA2();
      console.log('[Validation] Query A2 (skip count):', result.queries.queryA2);
    } catch (err) {
      console.error('[Validation] Query A2 failed:', err);
      result.summary.issues.push(`Query A2 failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Query B2
    try {
      result.queries.queryB2 = await queryB2();
      console.log('[Validation] Query B2 (okrsV2-only projects):', result.queries.queryB2);
    } catch (err) {
      console.error('[Validation] Query B2 failed:', err);
      result.summary.issues.push(`Query B2 failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Query C
    try {
      result.queries.queryC = await queryC();
      console.log('[Validation] Query C (okrs table count):', result.queries.queryC);
    } catch (err) {
      console.error('[Validation] Query C failed:', err);
      result.summary.issues.push(`Query C failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Query D
    try {
      result.queries.queryD = await queryD();
      console.log('[Validation] Query D (RLS):', result.queries.queryD);
      if (!result.queries.queryD?.[0]?.rls_enabled) {
        result.summary.issues.push('RLS is not enabled on okrs table');
        result.summary.readyForBackfill = false;
      }
    } catch (err) {
      console.error('[Validation] Query D failed:', err);
      result.summary.issues.push(`Query D failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Query E
    try {
      result.queries.queryE = await queryE();
      console.log('[Validation] Query E (indexes):', result.queries.queryE);
      if (!result.queries.queryE || result.queries.queryE.length === 0) {
        result.summary.issues.push('No indexes found on okrs table');
      }
    } catch (err) {
      console.error('[Validation] Query E failed:', err);
      result.summary.issues.push(`Query E failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    console.error('[Validation] Unexpected error:', err);
    result.summary.issues.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    result.summary.readyForBackfill = false;
  }

  return result;
}

export default {
  queryA,
  queryA2,
  queryB2,
  queryC,
  queryD,
  queryE,
  queryF,
  queryG,
  runAllValidationQueries,
};
