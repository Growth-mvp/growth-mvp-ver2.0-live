// /app/api/debug/backfill-okrs/route.ts
/**
 * API route for backfill dry-run and execution
 *
 * 使用方法:
 * - DRY-RUN: POST /api/debug/backfill-okrs { "dryRun": true }
 * - 実行: POST /api/debug/backfill-okrs { "dryRun": false }
 *
 * レスポンス:
 * {
 *   success: boolean,
 *   dryRun: boolean,
 *   stats: { ... },
 *   skipReport: [ ... ],
 *   timestamp: ISO string
 * }
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

// Initialize Supabase client for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/* =========================================================
 * Deterministic ID generation (same as client-side)
 * ========================================================= */

function generateDeterministicId(seed: string): string {
  const NAMESPACE_OKR = '7b2ffc1c-7a8d-5e6f-8c9d-1a2b3c4d5e6f';
  return generateHashBasedUuid(NAMESPACE_OKR, seed);
}

function generateHashBasedUuid(namespace: string, seed: string): string {
  const combined = `${namespace}:${seed}`;
  let hash = 0;

  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  const hashHex = Math.abs(hash).toString(16).padStart(32, '0');
  return `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-5${hashHex.slice(12, 15)}-8${hashHex.slice(15, 19)}-${hashHex.slice(19, 31)}`;
}

/* =========================================================
 * Validation helpers
 * ========================================================= */

function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

function validateDepartmentId(dept: any): string | null {
  const id = dept?.id;
  if (!id) return null;
  return String(id);
}

function validateProjectId(proj: any): string | null {
  const id = proj?.id;
  if (!id) return null;
  return String(id);
}

function validateObjective(okr: any): string | null {
  const objective = okr?.objective;
  if (!objective) return null;
  return String(objective).trim();
}

function validateOwnerUserId(okr: any): string | null {
  const owner = okr?.owner;
  if (!owner) return null;
  return isValidUUID(String(owner)) ? String(owner) : null;
}

/* =========================================================
 * Main backfill handler
 * ========================================================= */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dryRun = true } = body;

    console.log(
      `[backfill-okrs-api] Starting ${dryRun ? 'DRY-RUN' : 'ACTUAL'} backfill...`
    );

    // Step 1: Query all strategy_data
    const { data: strategies, error: strategyError } = await supabase
      .from('strategy_data')
      .select('*');

    if (strategyError) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to query strategy_data: ${strategyError.message}`,
          dryRun,
        },
        { status: 500 }
      );
    }

    if (!strategies || strategies.length === 0) {
      return NextResponse.json({
        success: true,
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
        skipReport: [],
        message: 'No strategies found to backfill',
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`[backfill-okrs-api] Found ${strategies.length} strategies`);

    // Step 2: Collect OKRs to backfill
    const okrsToBackfill: any[] = [];
    const skipReport: any[] = [];
    const stats = {
      totalProcessed: 0,
      backfilled: 0,
      skipped: {
        noDepartmentId: 0,
        noProjectId: 0,
        noObjective: 0,
        invalidOwnerUuid: 0,
      },
      errors: [] as string[],
    };

    for (const strategy of strategies) {
      if (!strategy.company_id || !strategy.id) continue;

      // ★ NEW: Normalize strategy_data to auto-generate department.id and project.id
      const normalized = normalizeStrategyData(strategy);

      const strategyId = strategy.id;
      const companyId = strategy.company_id;
      const departments = normalized.departments || [];

      for (const dept of departments) {
        const departmentId = validateDepartmentId(dept);

        if (!departmentId) {
          stats.skipped.noDepartmentId++;
          skipReport.push({
            strategyId,
            departmentId: null,
            reason: 'department.id missing or invalid',
          });
          continue;
        }

        const projects = dept.projects || [];
        for (const proj of projects) {
          const projectId = validateProjectId(proj);

          if (!projectId) {
            stats.skipped.noProjectId++;
            skipReport.push({
              strategyId,
              departmentId,
              projectId: null,
              reason: 'project.id missing or invalid',
            });
            continue;
          }

          const okrs = proj.okrs || [];
          for (let sortOrder = 0; sortOrder < okrs.length; sortOrder++) {
            const okr = okrs[sortOrder];
            const objective = validateObjective(okr);

            if (!objective) {
              stats.skipped.noObjective++;
              skipReport.push({
                strategyId,
                departmentId,
                projectId,
                objective: null,
                reason: 'objective missing or invalid',
              });
              continue;
            }

            stats.totalProcessed++;

            let ownerUserId: string | null = null;
            if (okr.owner) {
              ownerUserId = validateOwnerUserId(okr);
              if (okr.owner && !ownerUserId) {
                stats.skipped.invalidOwnerUuid++;
                skipReport.push({
                  strategyId,
                  departmentId,
                  projectId,
                  objective,
                  reason: `owner_user_id invalid UUID: ${okr.owner}`,
                });
                continue;
              }
            }

            // Generate deterministic ID
            const seed = `${strategyId}:${departmentId}:${projectId}:${objective}:${sortOrder}`;
            const okrId =
              okr.id && isValidUUID(okr.id)
                ? okr.id
                : generateDeterministicId(seed);

            okrsToBackfill.push({
              company_id: companyId,
              strategy_id: strategyId,
              department_id: departmentId,
              project_id: projectId,
              id: okrId,
              objective,
              key_results_json: okr.keyResults || [],
              owner_user_id: ownerUserId,
              owner_name:
                okr.ownerName ||
                (okr.owner && !ownerUserId ? okr.owner : null),
              status: 'draft',
              sort_order: sortOrder,
              source_stage: 'migration',
              source_okr_id: okr.id || null,
              is_deleted: false,
              created_at: strategy.updated_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    console.log(
      `[backfill-okrs-api] Prepared ${okrsToBackfill.length} OKRs for backfill`
    );

    // Step 3: Insert OKRs (or dry-run)
    if (dryRun) {
      stats.backfilled = okrsToBackfill.length;
      console.log(
        `[backfill-okrs-api] DRY-RUN: Would insert ${okrsToBackfill.length} OKRs`
      );
    } else {
      // 本番実行
      const { error: insertError } = await supabase
        .from('okrs')
        .upsert(okrsToBackfill, {
          onConflict: 'id',
        });

      if (insertError) {
        const msg = `Failed to upsert OKRs: ${insertError.message}`;
        console.error(`[backfill-okrs-api] ${msg}`);
        stats.errors.push(msg);
      } else {
        stats.backfilled = okrsToBackfill.length;
        console.log(`[backfill-okrs-api] Successfully inserted ${okrsToBackfill.length} OKRs`);
      }
    }

    return NextResponse.json({
      success: stats.errors.length === 0,
      dryRun,
      stats,
      skipReport,
      okrsPreview: dryRun ? okrsToBackfill.slice(0, 5) : undefined,
      totalOkrsPrepared: okrsToBackfill.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[backfill-okrs-api] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST with { "dryRun": true/false } to run backfill',
    endpoint: '/api/debug/backfill-okrs',
  });
}
