// /utils/supabase/backfillOkrs.ts
'use client';

/**
 * 役割：
 * - strategy_data から okrs テーブルへのデータ移行（Phase 2A-3 Backfill）
 * - 決定的 ID 生成で idempotent 実行を保証
 * - 不正なデータ（id 不足など）はスキップして報告
 * - 本番運用では gen_random_uuid() fallback を使用しない
 *
 * 実行方法：
 * 1. Dry-run: await backfillOkrsFromStrategyData({ dryRun: true })
 * 2. 本番: await backfillOkrsFromStrategyData({ dryRun: false })
 */

import { supabase, assertCompanyId } from './client';
import { okrsRepository } from './okrsRepository';
import type { OkrWriteInput, BackfillOkrData } from '@/types/okrs';
import type { StrategyData, Department, Project } from '@/types/strategy';

/* =========================================================
 * 決定的 ID 生成（UUID5 相当）
 * ========================================================= */

/**
 * Deterministic UUID5-like ID generation
 * Same seed always produces same UUID
 *
 * Seed format: `${strategy_id}:${department_id}:${project_id}:${objective}:${sort_order}`
 */
function generateDeterministicId(seed: string): string {
  // UUID5 namespace for OKR migration
  const NAMESPACE_OKR = '7b2ffc1c-7a8d-5e6f-8c9d-1a2b3c4d5e6f';

  // For deterministic ID generation, we use SHA-1 based UUID5 algorithm
  // This is a simplified implementation - in production, consider using a library like 'uuid'
  // For now, we'll use a crypto-based approach

  if (typeof crypto === 'undefined') {
    // Fallback for server-side: use simpler deterministic generation
    return generateHashBasedUuid(NAMESPACE_OKR, seed);
  }

  // Browser-side: use SubtleCrypto if available
  try {
    // Hash the seed with namespace
    const combined = `${NAMESPACE_OKR}:${seed}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Convert hash to UUID-like string
    const hashHex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${NAMESPACE_OKR.split('-')[0]}-${NAMESPACE_OKR.split('-')[1]}-5${hashHex.slice(1)}-8${hashHex.slice(3, 5)}-${hashHex.padEnd(12, '0')}`;
  } catch {
    return generateHashBasedUuid(NAMESPACE_OKR, seed);
  }
}

/**
 * Hash-based deterministic UUID generation
 */
function generateHashBasedUuid(namespace: string, seed: string): string {
  const combined = `${namespace}:${seed}`;
  let hash = 0;

  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  const hashHex = Math.abs(hash).toString(16).padStart(32, '0');

  // Format as UUID: 8-4-4-4-12
  return `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-5${hashHex.slice(12, 15)}-8${hashHex.slice(15, 19)}-${hashHex.slice(19, 31)}`;
}

/* =========================================================
 * 検証ヘルパー
 * ========================================================= */

/**
 * UUID validation
 */
function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate department has id
 */
function validateDepartmentId(dept: any): string | null {
  // ★ 複数の ID フィールド候補を確認
  const idCandidates = {
    id: dept?.id,
    departmentId: dept?.departmentId,
    name: dept?.name ?? '[no-name]',
  };

  // 優先順位: id > departmentId
  const id = dept?.id ?? dept?.departmentId;
  if (!id) return null;
  if (typeof id !== 'string' && typeof id !== 'number') return null;

  // ★ ログ（DEBUG 時）
  if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[backfillOkrs][validateDepartmentId] department id validation', {
      idCandidates,
      selectedId: String(id),
      isValid: true,
    });
  }

  return String(id);
}

/**
 * Validate project has id
 */
function validateProjectId(proj: any): string | null {
  // ★ 複数の ID フィールド候補を確認
  const idCandidates = {
    id: proj?.id,
    projectId: proj?.projectId,
    title: proj?.title ?? '[no-title]',
  };

  // 優先順位: id > projectId
  const id = proj?.id ?? proj?.projectId;
  if (!id) return null;
  if (typeof id !== 'string' && typeof id !== 'number') return null;

  // ★ ログ（DEBUG 時）
  if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[backfillOkrs][validateProjectId] project id validation', {
      idCandidates,
      selectedId: String(id),
      isValid: true,
    });
  }

  return String(id);
}

/**
 * Validate OKR objective
 */
function validateObjective(okr: any): string | null {
  const objective = okr?.objective;
  if (!objective) return null;
  if (typeof objective !== 'string') return null;
  return objective.trim();
}

/**
 * Validate owner_user_id if present
 */
function validateOwnerUserId(okr: any): string | null {
  const owner = okr?.owner;
  if (!owner) return null;
  if (typeof owner !== 'string') return null;
  return isValidUUID(owner) ? owner : null;
}

/* =========================================================
 * メイン Backfill 関数
 * ========================================================= */

export interface BackfillOptions {
  dryRun?: boolean;
  companyId?: string;
  strategyId?: string;
}

export interface BackfillStats {
  totalProcessed: number;
  backfilled: number;
  skipped: {
    noDepartmentId: number;
    noProjectId: number;
    noObjective: number;
    invalidOwnerUuid: number;
  };
  errors: string[];
}

export interface BackfillResult {
  success: boolean;
  stats: BackfillStats;
  dryRun: boolean;
  insertedOkrs?: BackfillOkrData[];
  skipReport?: Array<{
    strategyId: string;
    departmentName?: string;
    departmentId?: string | null;
    rawDepartmentId?: any;
    projectTitle?: string;
    projectId?: string | null;
    rawProjectId?: any;
    objective?: string | null;
    objectiveCandidates?: any[];
    reason: string;
  }>;
  strategyProjectInventory?: Array<{
    departmentName?: string;
    departmentId?: string | null;
    projectTitle?: string;
    projectId?: string | null;
    okrCount: number;
    objectiveCandidates?: any[];
  }>;
}

/**
 * Main backfill function: strategy_data → okrs table
 *
 * プロセス:
 * 1. strategy_data をすべて取得
 * 2. departments → projects → okrs をループ
 * 3. 必須フィールド検証（department.id, project.id, objective）
 * 4. 決定的 ID 生成
 * 5. Dry-run or 実際に okrsRepository.upsert() で保存
 * 6. 統計レポート返却
 */
export async function backfillOkrsFromStrategyData(
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const { dryRun = true, companyId: filterCompanyId } = options;

  const result: BackfillResult = {
    success: false,
    dryRun,
    stats: {
      totalProcessed: 0,
      backfilled: 0,
      skipped: {
        noDepartmentId: 0,
        noProjectId: 0,
        noObjective: 0,
        invalidOwnerUuid: 0,
      },
      errors: [],
    },
    insertedOkrs: [],
    skipReport: [],
    strategyProjectInventory: [],
  };

  try {
    console.log(
      `[backfillOkrs] Starting ${dryRun ? 'DRY-RUN' : 'ACTUAL'} backfill...`
    );

    // Step 1: Query all strategy_data
    const { data: strategies, error: strategyError } = await supabase
      .from('strategy_data')
      .select('*');

    if (strategyError) {
      const msg = `Failed to query strategy_data: ${strategyError.message}`;
      console.error(`[backfillOkrs] ${msg}`);
      result.stats.errors.push(msg);
      return result;
    }

    if (!strategies || strategies.length === 0) {
      console.log('[backfillOkrs] No strategy_data found, nothing to backfill');
      result.success = true;
      return result;
    }

    console.log(`[backfillOkrs] Found ${strategies.length} strategies`);

    // Step 2: Iterate and collect OKR data to backfill
    const okrsToBackfill: Array<{
      data: BackfillOkrData;
      sortOrder: number;
    }> = [];

    for (const strategy of strategies as StrategyData[]) {
      // Filter by companyId if specified
      if (filterCompanyId && strategy.company_id !== filterCompanyId) {
        continue;
      }

      if (!strategy.company_id || !strategy.id) {
        continue;
      }

      const strategyId = strategy.id;
      const companyId = strategy.company_id;
      const departments = strategy.departments || [];

      for (const dept of departments) {
        const departmentId = validateDepartmentId(dept);
        const departmentName = (dept as any)?.name ?? `[unnamed:${departmentId ?? 'no-id'}]`;
        const rawDepartmentId = (dept as any)?.id;

        // ★ inventory に記録（全 department/project の一覧）
        const deptProjects = (dept as any)?.projects || [];
        for (const proj of deptProjects) {
          const projectId = validateProjectId(proj);
          const projectTitle = (proj as any)?.title ?? `[unnamed:${projectId ?? 'no-id'}]`;
          const rawProjectId = (proj as any)?.id;
          const projectIdCandidates = {
            id: (proj as any)?.id,
            projectId: (proj as any)?.projectId,
          };
          const okrs = proj?.okrs || [];

          result.strategyProjectInventory?.push({
            departmentName,
            departmentId,
            projectTitle,
            projectId,
            okrCount: okrs.length,
            objectiveCandidates: okrs.map((o: any) => ({
              objective: o?.objective ?? '[empty]',
              owner: o?.owner ?? null,
              keyResultsCount: Array.isArray(o?.keyResults) ? o.keyResults.length : 0,
            })),
          });

          // ★ PROJECT ID CANDIDATES DEBUG LOG
          if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
            console.log('[backfillOkrs][inventory] project id-field candidates', {
              departmentName,
              departmentIdCandidates: { id: (dept as any)?.id, departmentId: (dept as any)?.departmentId, name: departmentName },
              projectTitle,
              projectIdCandidates,
              validatedProjectId: projectId,
              okrCount: okrs.length,
            });
          }
        }

        if (!departmentId) {
          result.stats.skipped.noDepartmentId++;
          result.skipReport?.push({
            strategyId,
            departmentName,
            departmentId: null,
            rawDepartmentId,
            reason: 'department.id missing or invalid',
          });
          continue;
        }

        const projects = dept.projects || [];
        for (const proj of projects) {
          const projectId = validateProjectId(proj);
          const projectTitle = (proj as any)?.title ?? `[unnamed:${projectId ?? 'no-id'}]`;
          const rawProjectId = (proj as any)?.id;

          if (!projectId) {
            result.stats.skipped.noProjectId++;
            result.skipReport?.push({
              strategyId,
              departmentName,
              departmentId,
              rawDepartmentId,
              projectTitle,
              projectId: null,
              rawProjectId,
              reason: 'project.id missing or invalid',
            });
            continue;
          }

          const okrs = proj.okrs || [];
          for (let sortOrder = 0; sortOrder < okrs.length; sortOrder++) {
            const okr = okrs[sortOrder];
            const objective = validateObjective(okr);

            if (!objective) {
              result.stats.skipped.noObjective++;
              result.skipReport?.push({
                strategyId,
                departmentName,
                departmentId,
                rawDepartmentId,
                projectTitle,
                projectId,
                rawProjectId,
                objective: null,
                objectiveCandidates: okrs.map((o: any) => ({
                  objective: o?.objective ?? '[empty]',
                  owner: o?.owner ?? null,
                })),
                reason: 'objective missing or invalid',
              });
              continue;
            }

            result.stats.totalProcessed++;

            // Validate owner_user_id if present
            let ownerUserId: string | null = null;
            if (okr.owner) {
              ownerUserId = validateOwnerUserId(okr);
              if (okr.owner && !ownerUserId) {
                result.stats.skipped.invalidOwnerUuid++;
                result.skipReport?.push({
                  strategyId,
                  departmentName,
                  departmentId,
                  rawDepartmentId,
                  projectTitle,
                  projectId,
                  rawProjectId,
                  objective,
                  reason: `owner_user_id invalid UUID: ${okr.owner}`,
                });
                continue;
              }
            }

            // Generate deterministic ID
            const seed = `${strategyId}:${departmentId}:${projectId}:${objective}:${sortOrder}`;
            const okrId =
              okr.id && typeof okr.id === 'string' && isValidUUID(okr.id)
                ? okr.id
                : generateDeterministicId(seed);

            // Prepare backfill data
            const backfillData: BackfillOkrData = {
              company_id: companyId as any,
              strategy_id: strategyId as any,
              department_id: departmentId,
              project_id: projectId,
              okr_id: okrId,
              objective,
              key_results_json: okr.keyResults || [],
              owner_user_id: ownerUserId as any,
              owner_name:
                okr.ownerName ||
                (okr.owner && !ownerUserId ? okr.owner : null),
              source_okr_id: okr.id,
              created_at: strategy.updated_at || new Date().toISOString(),
            };

            okrsToBackfill.push({
              data: backfillData,
              sortOrder,
            });
          }
        }
      }
    }

    console.log(
      `[backfillOkrs] Prepared ${okrsToBackfill.length} OKRs for backfill`
    );

    // Step 3: Insert OKRs
    if (dryRun) {
      console.log('[backfillOkrs] DRY-RUN: Would insert', okrsToBackfill.length, 'OKRs');
      result.insertedOkrs = okrsToBackfill.map((item) => item.data);
      result.stats.backfilled = okrsToBackfill.length;
    } else {
      // 本番実行: 実際に okrsRepository.upsert() で保存
      for (const item of okrsToBackfill) {
        try {
          const input: OkrWriteInput = {
            id: item.data.okr_id,
            strategy_id: item.data.strategy_id,
            department_id: item.data.department_id,
            project_id: item.data.project_id,
            objective: item.data.objective,
            key_results_json: item.data.key_results_json,
            owner_user_id: item.data.owner_user_id || null,
            owner_name: item.data.owner_name || null,
            status: 'draft',
            sort_order: item.sortOrder,
            source_stage: 'migration',
            source_okr_id: item.data.source_okr_id || null,
            is_deleted: false,
          };

          await okrsRepository.upsert(input, item.data.company_id);
          result.stats.backfilled++;
        } catch (err) {
          const msg = `Failed to upsert OKR ${item.data.okr_id}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`[backfillOkrs] ${msg}`);
          result.stats.errors.push(msg);
        }
      }
    }

    result.success = result.stats.errors.length === 0;

    console.log('[backfillOkrs] Backfill complete:', {
      success: result.success,
      backfilled: result.stats.backfilled,
      skipped: result.stats.skipped,
      errors: result.stats.errors.length,
    });

    // ★ 詳細ログ：Strategy Project Inventory
    if (result.strategyProjectInventory && result.strategyProjectInventory.length > 0) {
      console.group('[backfillOkrs] 📋 Strategy Project Inventory (全プロジェクト一覧)');
      result.strategyProjectInventory.forEach((item, idx) => {
        console.log(`[${idx + 1}] ${item.departmentName} > ${item.projectTitle}`, {
          departmentId: item.departmentId,
          projectId: item.projectId,
          okrCount: item.okrCount,
          objectiveCandidates: item.objectiveCandidates,
        });
      });
      console.groupEnd();
    }

    // ★ 詳細ログ：Skip Report（最大10件）
    if (result.skipReport && result.skipReport.length > 0) {
      console.group(`[backfillOkrs] ⚠️ Skip Report (${result.skipReport.length} 件、最大10件表示)`);
      result.skipReport.slice(0, 10).forEach((item, idx) => {
        console.log(`[除外${idx + 1}]`, {
          departmentName: item.departmentName,
          departmentId: item.departmentId,
          rawDepartmentId: item.rawDepartmentId,
          projectTitle: item.projectTitle,
          projectId: item.projectId,
          rawProjectId: item.rawProjectId,
          objective: item.objective,
          objectiveCandidates: item.objectiveCandidates,
          reason: item.reason,
        });
      });
      if (result.skipReport.length > 10) {
        console.log(`[... 他 ${result.skipReport.length - 10} 件省略]`);
      }
      console.groupEnd();
    }

    return result;
  } catch (err) {
    const msg = `Unexpected error in backfillOkrsFromStrategyData: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[backfillOkrs] ${msg}`);
    result.stats.errors.push(msg);
    return result;
  }
}

/**
 * Query validation before backfill
 * Run the SQL validation queries to check data integrity
 */
export async function runValidationQueries(): Promise<{
  queryA: Array<{
    backfill_okr_count: number;
    strategy_count: number;
    department_with_id_count: number;
    project_with_id_count: number;
  }>;
  queryA2: Array<{
    skipped_okr_count: number;
    no_department_id: number;
    no_project_id: number;
  }>;
  queryB2: Array<{
    okrsV2_only_project_count: number;
    total_okrsV2_count: number;
  }>;
  queryC: Array<{ okrs_table_count: number; active_okr_count: number }>;
}> {
  const result = {
    queryA: [],
    queryA2: [],
    queryB2: [],
    queryC: [],
  };

  try {
    // Query A: Backfill target count
    const { data: qA } = await supabase.rpc('exec_query_a', {});
    if (qA) result.queryA = Array.isArray(qA) ? qA : [qA];

    // Query A2: Skip count
    const { data: qA2 } = await supabase.rpc('exec_query_a2', {});
    if (qA2) result.queryA2 = Array.isArray(qA2) ? qA2 : [qA2];

    // Query B2: okrsV2-only projects
    const { data: qB2 } = await supabase.rpc('exec_query_b2', {});
    if (qB2) result.queryB2 = Array.isArray(qB2) ? qB2 : [qB2];

    // Query C: okrs table count (post-backfill)
    const { data: qC } = await supabase.rpc('exec_query_c', {});
    if (qC) result.queryC = Array.isArray(qC) ? qC : [qC];
  } catch (err) {
    console.error('[backfillOkrs] Error running validation queries:', err);
  }

  return result;
}

export default {
  backfillOkrsFromStrategyData,
  runValidationQueries,
};
