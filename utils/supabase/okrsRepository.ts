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
 * - id が無い場合は生成
 * - is_deleted = false で作成
 * - updated_at は自動更新
 */
export async function upsert(
  input: OkrWriteInput,
  companyId: string
): Promise<OkrRow> {
  assertCompanyId(companyId);

  // ID がない場合は UUID 生成（DB側で gen_random_uuid() も可）
  const okrId = input.id || crypto.randomUUID?.() || `okr_${Date.now()}`;

  const insertData = {
    id: okrId,
    company_id: companyId,
    strategy_id: input.strategy_id,
    department_id: input.department_id,
    project_id: input.project_id,
    objective: input.objective,
    key_results_json: input.key_results_json || [],
    owner_user_id: input.owner_user_id || null,
    owner_name: input.owner_name || null,
    status: input.status || 'draft',
    sort_order: input.sort_order ?? 0,
    source_stage: input.source_stage || 'migration',
    source_okr_id: input.source_okr_id || null,
    is_deleted: false,
    meta_json: input.meta_json || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(insertData, {
      onConflict: 'id',
    })
    .select()
    .single();

  if (error) {
    console.error('[okrsRepository.upsert] error:', error);
    throw error;
  }

  if (!data) {
    throw new Error('[okrsRepository.upsert] No data returned after upsert');
  }

  return data as OkrRow;
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
