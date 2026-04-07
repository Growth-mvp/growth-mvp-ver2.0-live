// /utils/supabase/okrsRepository.ts
'use client';

/**
 * 役割：
 * - okrs テーブルへの CRUD 操作（正本ソース）
 * - OkrRow ↔ OkrWriteInput の型変換
 * - Soft delete の統一管理
 * - RLS による company_id スコープ自動適用
 *
 * 注意：
 * - すべてクライアント限定（'use client'）
 * - Repository は型変換のみ担当、ビジネスロジックは Service に
 * - Supabase error は呼び出し側で処理
 */

import { supabase, assertCompanyId } from './client';
import type { OkrRow, OkrWriteInput, ResolvedOkr } from '@/types/okrs';

const TABLE_NAME = 'okrs';

/* =========================================================
 * 主要な query/mutation メソッド
 * ========================================================= */

/**
 * プロジェクト単位で OKR を取得（並び順付き）
 * - is_deleted = false のみ読み取り
 * - sort_order で昇順に並べる
 */
export async function queryByProjectId(
  projectId: string,
  companyId: string
): Promise<OkrRow[]> {
  assertCompanyId(companyId);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('company_id', companyId)
    .eq('project_id', projectId)
    .eq('is_deleted', false)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[okrsRepository.queryByProjectId] error:', error);
    throw error;
  }

  return data ?? [];
}

/**
 * 戦略単位で OKR を取得
 * - is_deleted = false のみ読み取り
 * - department + project 単位で group 可能
 */
export async function queryByStrategyId(
  strategyId: string,
  companyId: string
): Promise<OkrRow[]> {
  assertCompanyId(companyId);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('company_id', companyId)
    .eq('strategy_id', strategyId)
    .eq('is_deleted', false);

  if (error) {
    console.error('[okrsRepository.queryByStrategyId] error:', error);
    throw error;
  }

  return data ?? [];
}

/**
 * OKR ID 指定で単一取得
 */
export async function queryById(
  okrId: string,
  companyId: string
): Promise<OkrRow | null> {
  assertCompanyId(companyId);

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('id', okrId)
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error) {
    console.error('[okrsRepository.queryById] error:', error);
    throw error;
  }

  return data ?? null;
}

/**
 * OKR をアップサート（挿入または更新）
 *
 * ★ 修正（2026-04-06）：DB partial unique index okrs_unique_active_business_key 対応
 * - id が指定されている場合：id で UPDATE（既存 OKR の内容修正）
 * - id がない場合：company_id + strategy_id + department_id + project_id + objective で衝突判定
 *   → 同じ project_id + objective なら UPDATE（新規 INSERT ではなく）
 *   → is_deleted=true の履歴行と独立（partial index で自動フィルタ）
 *
 * 効果：
 * - 新規重複の発生を防止
 * - 同じ OKR の再保存で必ず同じ行に収束（UPDATE 相当）
 */
export async function upsert(
  input: OkrWriteInput,
  companyId: string
): Promise<OkrRow> {
  assertCompanyId(companyId);

  const nowIso = new Date().toISOString();
  const normalizedObjective = String(input.objective ?? '').trim();
  if (!normalizedObjective) {
    throw new Error('[okrsRepository.upsert] objective is required');
  }

  const basePayload = {
    company_id: companyId,
    strategy_id: input.strategy_id,
    department_id: input.department_id,
    project_id: input.project_id,
    objective: normalizedObjective,
    key_results_json: input.key_results_json || [],
    owner_user_id: input.owner_user_id || null,
    owner_name: input.owner_name || null,
    status: input.status || 'draft',
    sort_order: input.sort_order ?? 0,
    source_stage: input.source_stage || 'migration',
    source_okr_id: input.source_okr_id || null,
    is_deleted: false,
    meta_json: input.meta_json || {},
    updated_at: nowIso,
  };

  try {
    // 1) id 指定時はその id を最優先で更新
    if (input.id) {
      const okrId = String(input.id).trim();
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update(basePayload)
        .eq('id', okrId)
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .select()
        .maybeSingle();

      if (error) {
        console.error('[okrsRepository.upsert] update-by-id error detail:', {
          message: (error as any)?.message,
          code: (error as any)?.code,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          status: (error as any)?.status,
          input,
        });
        throw error;
      }

      if (data) return data as OkrRow;
    }

    // 2) active business key で既存行を検索
    const { data: existing, error: findError } = await supabase
      .from(TABLE_NAME)
      .select('id')
      .eq('company_id', companyId)
      .eq('strategy_id', input.strategy_id)
      .eq('department_id', input.department_id)
      .eq('project_id', input.project_id)
      .eq('objective', normalizedObjective)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(2);

    if (findError) {
      console.error('[okrsRepository.upsert] find-existing error detail:', {
        message: (findError as any)?.message,
        code: (findError as any)?.code,
        details: (findError as any)?.details,
        hint: (findError as any)?.hint,
        status: (findError as any)?.status,
        input,
      });
      throw findError;
    }

    if (Array.isArray(existing) && existing.length > 1) {
      console.warn('[okrsRepository.upsert] multiple active rows detected for business key; updating newest row', {
        companyId,
        strategy_id: input.strategy_id,
        department_id: input.department_id,
        project_id: input.project_id,
        objective: normalizedObjective,
        ids: existing.map((row: any) => row?.id).filter(Boolean),
      });
    }

    const existingId = Array.isArray(existing) && existing[0]?.id ? String(existing[0].id) : '';
    if (existingId) {
      const { data, error } = await supabase
        .from(TABLE_NAME)
        .update(basePayload)
        .eq('id', existingId)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error) {
        console.error('[okrsRepository.upsert] update-by-business-key error detail:', {
          message: (error as any)?.message,
          code: (error as any)?.code,
          details: (error as any)?.details,
          hint: (error as any)?.hint,
          status: (error as any)?.status,
          input,
          existingId,
        });
        throw error;
      }

      if (!data) throw new Error('[okrsRepository.upsert] No data returned after update-by-business-key');
      return data as OkrRow;
    }

    // 3) 見つからなければ新規 INSERT
    const insertId = input.id || crypto.randomUUID?.() || `okr_${Date.now()}`;
    const insertData = {
      id: insertId,
      ...basePayload,
      created_at: nowIso,
    };

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[okrsRepository.upsert] insert error detail:', {
        message: (error as any)?.message,
        code: (error as any)?.code,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
        status: (error as any)?.status,
        input,
        insertId,
      });
      throw error;
    }

    if (!data) {
      throw new Error('[okrsRepository.upsert] No data returned after insert');
    }

    return data as OkrRow;
  } catch (error) {
    console.error('[okrsRepository.upsert] error detail:', {
      message: (error as any)?.message,
      code: (error as any)?.code,
      details: (error as any)?.details,
      hint: (error as any)?.hint,
      status: (error as any)?.status,
      input,
    });
    throw error;
  }
}

/**
 * OKR をソフト削除
 * - is_deleted = true に更新
 * - 物理削除しない（ロールバック可能）
 */
export async function softDelete(okrId: string, companyId: string): Promise<void> {
  assertCompanyId(companyId);

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      is_deleted: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', okrId)
    .eq('company_id', companyId);

  if (error) {
    console.error('[okrsRepository.softDelete] error:', error);
    throw error;
  }
}

/**
 * OKR の並び順を一括更新
 * - 複数 OKR の sort_order を一度に更新
 * - トランザクションは不使用（個別の update で対応）
 */
export async function batchUpdateSortOrder(
  items: Array<{ id: string; sort_order: number }>,
  companyId: string
): Promise<void> {
  assertCompanyId(companyId);

  // 複数アップデートが必要なため、順序保存は for...of でループ
  // （Supabase JS SDK は batch upsert 対応だが、単一テーブルの複数 row update 向けは限定的）
  for (const item of items) {
    const { error } = await supabase
      .from(TABLE_NAME)
      .update({
        sort_order: item.sort_order,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('company_id', companyId);

    if (error) {
      console.error(`[okrsRepository.batchUpdateSortOrder] error for id=${item.id}:`, error);
      throw error;
    }
  }
}

/**
 * デバッグ用：全 OKR カウント（company_id スコープ）
 */
export async function countAll(companyId: string): Promise<number> {
  assertCompanyId(companyId);

  const { count, error } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_deleted', false);

  if (error) {
    console.error('[okrsRepository.countAll] error:', error);
    return 0;
  }

  return count ?? 0;
}

/**
 * デバッグ用：削除済み OKR カウント
 */
export async function countDeleted(companyId: string): Promise<number> {
  assertCompanyId(companyId);

  const { count, error } = await supabase
    .from(TABLE_NAME)
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_deleted', true);

  if (error) {
    console.error('[okrsRepository.countDeleted] error:', error);
    return 0;
  }

  return count ?? 0;
}

/* =========================================================
 * Export: singleton instance または namespace
 * ========================================================= */

export const okrsRepository = {
  queryByProjectId,
  queryByStrategyId,
  queryById,
  upsert,
  softDelete,
  batchUpdateSortOrder,
  countAll,
  countDeleted,
};

export default okrsRepository;
