import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { isValidUUID } from '@/lib/utils/isValidUUID';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import {
  COMPANY_SCOPED_TABLES_BEFORE_STRATEGY,
  STRATEGY_DATA_RESET_VALUES,
  type CompanyScopedTable,
} from '@/lib/server/companyDataReset';

type DeleteAllAuditPhase = 'started' | 'success' | 'failure';
type AuditMeta = { ip: string | null; userAgent: string | null };
type AuditCtx = { companyId: string; actorUserId: string; beforeState: unknown; auditMeta: AuditMeta };

/**
 * 全データ削除の監査（audit_logs）。件数と結果のみを記録し、本文は記録しない。
 * logAuditEvent は失敗を false で返すため、呼び出し側は戻り値で必ず判断する。
 */
async function recordDeleteAllAudit(params: {
  companyId: string;
  actorUserId: string;
  phase: DeleteAllAuditPhase;
  metadata: Record<string, unknown>;
  auditMeta: AuditMeta;
}): Promise<boolean> {
  return logAuditEvent({
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    action: 'data:delete-all',
    targetType: 'company',
    targetId: params.companyId,
    metadata: { phase: params.phase, ...params.metadata },
    ip: params.auditMeta.ip,
    userAgent: params.auditMeta.userAgent,
  });
}

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

function isMissingTableError(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code);
}

/** strategy_data.story の空化を許可するDB側の例外（サービスロールの全削除だけが付ける） */
const STORY_RESET_SCOPE_HEADER = 'x-growth-reset-scope';
const STORY_RESET_SCOPE_VALUE = 'company-business-data';

const newOperationId = () => `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const summarizeValue = (v: unknown): number | string => {
  if (Array.isArray(v)) return v.length;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return 'object';
  return 'set';
};

function summarizeStrategyRow(row: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    Object.keys(STRATEGY_DATA_RESET_VALUES).map((col) => [col, summarizeValue(row?.[col])])
  );
}

const isSameJson = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);

type ScopeFilter = { column: 'company_id' | 'strategy_id'; value: string };

/** 対象テーブルの絞り込み条件。戦略行がない場合は strategy 指定の条件を作らない（対象行もない） */
function scopeFilters(target: CompanyScopedTable, companyId: string, strategyId: string | null): ScopeFilter[] {
  return target.scopes.flatMap((scope): ScopeFilter[] => {
    if (scope === 'company') return [{ column: 'company_id', value: companyId }];
    return strategyId ? [{ column: 'strategy_id', value: strategyId }] : [];
  });
}

type TableDeletion = {
  table: string;
  ok: boolean;
  deletedCount: number;
  skipped: 'table_missing' | null;
  error: { message: string; code?: string } | null;
};

/**
 * 会社の行を条件ごとに削除し、削除後に残存がないことを確認する。
 * 存在しない optional テーブルのみスキップし、それ以外の失敗は必ず失敗として返す。
 */
async function deleteCompanyRows(
  admin: SupabaseClient,
  target: CompanyScopedTable,
  companyId: string,
  strategyId: string | null
): Promise<TableDeletion> {
  const { table } = target;
  let deletedCount = 0;

  for (const filter of scopeFilters(target, companyId, strategyId)) {
    const deleted = await admin.from(table).delete({ count: 'exact' }).eq(filter.column, filter.value);
    if (deleted.error) {
      if (target.optional && isMissingTableError(deleted.error)) {
        return { table, ok: true, deletedCount: 0, skipped: 'table_missing', error: null };
      }
      return { table, ok: false, deletedCount, skipped: null, error: { message: deleted.error.message, code: deleted.error.code } };
    }
    deletedCount += deleted.count ?? 0;

    const remaining = await admin
      .from(table)
      .select(filter.column, { count: 'exact', head: true })
      .eq(filter.column, filter.value);
    if (remaining.error) {
      return { table, ok: false, deletedCount, skipped: null, error: { message: remaining.error.message, code: remaining.error.code } };
    }
    if ((remaining.count ?? 0) > 0) {
      return { table, ok: false, deletedCount, skipped: null, error: { message: `${table} rows remain after deletion` } };
    }
  }
  return { table, ok: true, deletedCount, skipped: null, error: null };
}

/** 会社の経営データが空かを確認する（strategy_data の経営列、関連テーブルの件数） */
async function verifyCompanyDataEmpty(admin: SupabaseClient, companyId: string, strategyId: string | null) {
  const strategy = await admin.from('strategy_data').select('*').eq('company_id', companyId).maybeSingle();
  if (strategy.error) {
    return { ok: false, remainingColumns: [] as string[], remainingRows: {} as Record<string, number>, error: strategy.error.message };
  }

  const row = strategy.data as Record<string, unknown> | null;
  const remainingColumns = row
    ? Object.entries(STRATEGY_DATA_RESET_VALUES)
        .filter(([col, expected]) => !isSameJson(row[col], expected))
        .map(([col]) => col)
    : [];

  const remainingRows: Record<string, number> = {};
  for (const target of COMPANY_SCOPED_TABLES_BEFORE_STRATEGY) {
    for (const filter of scopeFilters(target, companyId, strategyId)) {
      const counted = await admin
        .from(target.table)
        .select(filter.column, { count: 'exact', head: true })
        .eq(filter.column, filter.value);
      if (counted.error) {
        if (target.optional && isMissingTableError(counted.error)) continue;
        return { ok: false, remainingColumns, remainingRows, error: `${target.table}: ${counted.error.message}` };
      }
      if ((counted.count ?? 0) > 0) remainingRows[`${target.table}.${filter.column}`] = counted.count ?? 0;
    }
  }

  return {
    ok: remainingColumns.length === 0 && Object.keys(remainingRows).length === 0,
    remainingColumns,
    remainingRows,
    error: undefined as string | undefined,
  };
}

export async function POST(req: Request) {
  let auditCtx: AuditCtx | null = null;
  let mutationStarted = false;
  try {
    const admin = getSupabaseAdmin();

    // 1) Bearer トークンから userId を取得
    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });
    const authUserId = await getAuthUserIdFromBearer(admin, req);
    if (!authUserId) {
      console.error('[DELETE_ALL_API] Not authenticated');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2) 対象会社 ID をリクエストから取得する（利用者が確認した会社を明示的に指定させる）
    const body: unknown = await req.json().catch(() => null);
    const requestedCompanyId = (body as { companyId?: unknown } | null)?.companyId;
    if (typeof requestedCompanyId !== 'string' || !isValidUUID(requestedCompanyId)) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }

    // 3) 指定会社への admin 所属を確認する（他社の会社 ID や member/manager による削除は拒否）
    const { data: membershipData, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', authUserId)
      .eq('company_id', requestedCompanyId)
      .maybeSingle();

    if (membershipError || !membershipData || membershipData.role !== 'admin') {
      console.error('[DELETE_ALL_API] Not an admin of the requested company:', membershipError?.message);
      return NextResponse.json(
        { error: 'forbidden' },
        { status: 403 }
      );
    }

    const companyId = requestedCompanyId;

    // 4) 削除前の状態を読む（読めない場合は何も変更しない）
    const beforeCheck = await admin
      .from('strategy_data')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (beforeCheck.error) {
      console.error('[DELETE_ALL_API] Failed to read strategy_data before deletion:', beforeCheck.error.message);
      return NextResponse.json(
        { error: 'Failed to read strategy_data', detail: { message: beforeCheck.error.message, code: beforeCheck.error.code } },
        { status: 500 }
      );
    }

    const strategyId = (beforeCheck.data as { id?: unknown } | null)?.id;
    const strategyIdOrNull = typeof strategyId === 'string' ? strategyId : null;
    const beforeState = summarizeStrategyRow(beforeCheck.data as Record<string, unknown> | null);
    const auditMeta = extractAuditMetadata(req);
    auditCtx = { companyId, actorUserId: authUserId, beforeState, auditMeta };
    const recordFailure = (reason: string, extra: Record<string, unknown> = {}) =>
      recordDeleteAllAudit({
        companyId,
        actorUserId: authUserId,
        phase: 'failure',
        metadata: { reason, beforeState, ...extra },
        auditMeta,
      });

    const started = await recordDeleteAllAudit({
      companyId,
      actorUserId: authUserId,
      phase: 'started',
      metadata: { beforeState },
      auditMeta,
    });
    if (!started) {
      console.error('[DELETE_ALL_API] start audit could not be recorded; deletion not started', { companyId });
      return NextResponse.json(
        {
          ok: false,
          error: 'audit_unavailable',
          message: '監査ログを記録できなかったため、削除を開始していません。',
          companyId,
        },
        { status: 503 }
      );
    }

    // 5) 業務テーブルの削除（子テーブルを先に消す）
    mutationStarted = true;
    const separatedTableDeletions: Record<string, unknown> = {};
    for (const target of COMPANY_SCOPED_TABLES_BEFORE_STRATEGY) {
      const result = await deleteCompanyRows(admin, target, companyId, strategyIdOrNull);
      separatedTableDeletions[target.table] = {
        deleted_count: result.deletedCount,
        skipped: result.skipped,
        error: result.error,
      };
      if (!result.ok) {
        console.error('[DELETE_ALL_API] deletion failed, aborting', { companyId, table: target.table, code: result.error?.code });
        const auditRecorded = await recordFailure(`${target.table} deletion failed`, { separatedTableDeletions });
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to delete ${target.table}`,
            auditRecorded,
            operationId: newOperationId(),
            companyId,
            separatedTableDeletions,
            message: `Data deletion failed at ${target.table} deletion step. Run delete-all again to finish.`,
          },
          { status: 500 }
        );
      }
    }

    // 6) strategy_data の経営データ列を初期化（最後に行う。会社名・会社ID・所有者情報は変更しない）
    const { data: updatedRows, error: updateError } = await admin
      .from('strategy_data')
      .update({ ...STRATEGY_DATA_RESET_VALUES, updated_at: new Date().toISOString() })
      .setHeader(STORY_RESET_SCOPE_HEADER, STORY_RESET_SCOPE_VALUE)
      .eq('company_id', companyId)
      .select('company_id');

    if (updateError) {
      console.error('[DELETE_ALL_API] strategy_data update failed:', {
        message: updateError.message,
        code: updateError.code,
        details: (updateError as Record<string, any>).details,
        hint: (updateError as Record<string, any>).hint,
      });
      const auditRecorded = await recordFailure('strategy_data update failed', { error: updateError.message });
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to update strategy_data',
          auditRecorded,
          detail: {
            message: updateError.message,
            code: updateError.code,
            details: (updateError as Record<string, any>).details,
            hint: (updateError as Record<string, any>).hint,
          },
          operationId: newOperationId(),
        },
        { status: 500 }
      );
    }

    // 7) 削除後の再確認（直後と1秒後。遅れて書き戻された古いデータも検出する）
    const immediate = await verifyCompanyDataEmpty(admin, companyId, strategyIdOrNull);
    await new Promise((r) => setTimeout(r, 1000));
    const delayed = await verifyCompanyDataEmpty(admin, companyId, strategyIdOrNull);
    const verifySuccess = immediate.ok && delayed.ok;
    const afterState = {
      remainingColumns: delayed.remainingColumns,
      remainingRows: delayed.remainingRows,
      error: delayed.error ?? immediate.error ?? null,
    };

    if (!verifySuccess) {
      console.error('[DELETE_ALL_API] verification failed after deletion', { companyId, afterState });
      const auditRecorded = await recordFailure('verification failed after deletion', { afterState });
      return NextResponse.json(
        {
          ok: false,
          error: 'Deletion verification failed',
          auditRecorded,
          operationId: newOperationId(),
          companyId,
          separatedTableDeletions,
          afterState,
          message: 'Data still remains after deletion. Run delete-all again.',
        },
        { status: 500 }
      );
    }

    const updatedCount = updatedRows?.length ?? 0;
    const successAudit = await recordDeleteAllAudit({
      companyId,
      actorUserId: authUserId,
      phase: 'success',
      metadata: {
        beforeState,
        afterState,
        deletedCount: updatedCount,
        separatedTableDeletions,
      },
      auditMeta,
    });
    const operationId = newOperationId();
    if (!successAudit) {
      console.error('[DELETE_ALL_API] success audit could not be recorded after deletion', { companyId });
      return NextResponse.json(
        {
          ok: false,
          error: 'audit_record_failed_after_deletion',
          message: '削除は完了していますが、監査ログを記録できませんでした。運用担当へ連絡してください。',
          deletionCompleted: true,
          operationId,
          companyId,
          updatedCount,
          separatedTableDeletions,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        operationId,
        companyId,
        updatedCount,
        message: 'All data deleted successfully',
        beforeState,
        afterState,
        verifySuccess: true,
        separatedTableDeletions,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[DELETE_ALL_API] Exception:', error);
    let auditRecorded: boolean | null = null;
    const ctx = auditCtx as AuditCtx | null;
    if (ctx && mutationStarted) {
      auditRecorded = await recordDeleteAllAudit({
        companyId: ctx.companyId,
        actorUserId: ctx.actorUserId,
        phase: 'failure',
        metadata: { reason: 'exception', beforeState: ctx.beforeState },
        auditMeta: ctx.auditMeta,
      });
    }
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        deletionMayBeIncomplete: mutationStarted,
        auditRecorded,
      },
      { status: 500 }
    );
  }
}
