// /services/okrService.ts
'use client';

/**
 * 役割：
 * - OKR ビジネスロジックの一元化
 * - resolve（読込）、upsert（保存）、delete（削除）、reorder（並べ替え）
 * - strategy_data snapshot との統合（shape 更新まで、保存は委譲）
 * - merge ロジックで DB 優先 + snapshot fallback を統一
 *
 * 設計原則：
 * - resolveProjectsWithOkrs() は Phase 2A の統一読込関数
 * - ★ snapshot sync は形状更新のみ（Service 層は store.setDepartments() を呼ばない）
 * - ★ 実保存（DB/snapshot）は既存 save 導線（useAutoSave / saveStrategyData）に委ねる
 * - source フィールドで DB / snapshot を区別
 * - ★ DB 失敗時は snapshot を更新しない（failure safety）
 *
 * 責務分離：
 * - Service: ロジック + 計算 + snapshot shape 構築
 * - UI/Store: snapshot shape を受け取って実保存（useAutoSave など）
 * - Repository: DB 操作のみ
 *
 * 依存関係：
 * - okrsRepository: DB 操作
 * - OKR 型: types/okrs + types/strategy
 * - useStrategyStore: 読込のみ（書込は呼び出し側で）
 */

import { okrsRepository } from '@/utils/supabase/okrsRepository';
import { useStrategyStore } from '@/stores/strategyStore';
import type {
  OkrRow,
  OkrWriteInput,
  ResolvedOkr,
  ProjectWithResolvedOkrs,
  OkrMergeResult,
} from '@/types/okrs';
import type { OKR, StrategyData } from '@/types/strategy';

/* =========================================================
 * ヘルパー：Project.id 正規化
 * ========================================================= */

/**
 * Project.id を常に string に正規化
 * - id がない場合は null を返す（title ベース結びつけに戻さない）
 */
function normalizeProjectId(project: any): string | null {
  if (!project) return null;
  if (project.id) {
    return String(project.id); // number → string
  }
  return null; // id がない = legacy project（snapshot-only 扱い）
}

/* =========================================================
 * 主要関数：解決（読込）
 * ========================================================= */

/**
 * プロジェクト OKR の解決
 * - okrs テーブルから読込（DB優先）
 * - snapshot から fallback OKR を取得
 * - merge ロジックで統合
 * - source フィールドで区別可能
 *
 * ★ Legacy project 対応：
 * - project.id が無い場合は snapshot-only で返す（DB 照合不可）
 */
export async function resolveProjectsWithOkrs(
  projectId: string | null | undefined,
  departmentId: string | undefined,
  strategyData: StrategyData,
  companyId: string
): Promise<ProjectWithResolvedOkrs | null> {
  try {
    // 1. projectId が無い場合は早期リターン（legacy project）
    if (!projectId) {
      console.warn(`[okrService.resolveProjectsWithOkrs] projectId is missing (legacy project)`);
      return null;
    }

    // 2. strategy_data から該当プロジェクトを取得
    const project = findProjectInStrategyData(strategyData, projectId, departmentId);
    if (!project) {
      console.warn(`[okrService.resolveProjectsWithOkrs] Project not found: ${projectId}`);
      return null;
    }

    // 3. okrs テーブルから該当プロジェクトの OKR を取得
    let dbOkrs: OkrRow[] = [];
    try {
      // ★ Project.id の正規化：DB 照合時は常に string
      const normalizedProjId = normalizeProjectId(project);
      if (normalizedProjId) {
        dbOkrs = await okrsRepository.queryByProjectId(normalizedProjId, companyId);
      } else {
        // project.id が無い = legacy project（snapshot-only）
        console.warn(
          `[okrService.resolveProjectsWithOkrs] Project.id missing, using snapshot-only: ${project.title}`
        );
      }
    } catch (err) {
      console.warn('[okrService.resolveProjectsWithOkrs] queryByProjectId failed, fallback to snapshot:', err);
      // DB エラー時も snapshot fallback で継続可能
    }

    // 4. snapshot から fallback OKR を取得
    const snapshotOkrs = project.okrs ?? [];

    // 5. Merge（DB優先）
    const mergeResult = mergeOkrSources(dbOkrs, snapshotOkrs);

    return {
      ...project,
      resolvedOkrs: mergeResult.resolved,
    };
  } catch (err) {
    console.error('[okrService.resolveProjectsWithOkrs] unexpected error:', err);
    return null;
  }
}

/**
 * 複数プロジェクト OKR の一括解決（戦略単位）
 * - 各 department → project ごとに resolveProjectsWithOkrs() を呼び出し
 */
export async function resolveAllProjectsWithOkrs(
  strategyData: StrategyData,
  companyId: string
): Promise<StrategyData> {
  try {
    // strategy_data のコピーを作成し、departments を再構築
    const resolvedDepts = await Promise.all(
      (strategyData.departments ?? []).map(async (dept) => ({
        ...dept,
        projects: await Promise.all(
          (dept.projects ?? []).map(async (proj) => {
            const resolved = await resolveProjectsWithOkrs(
              proj.id ?? proj.title,
              dept.id ?? dept.name,
              strategyData,
              companyId
            );
            // resolvedOkrs が追加されたプロジェクトを返す
            return resolved ?? proj;
          })
        ),
      }))
    );

    return {
      ...strategyData,
      departments: resolvedDepts,
    };
  } catch (err) {
    console.error('[okrService.resolveAllProjectsWithOkrs] error:', err);
    return strategyData; // フォールバック：元のデータを返す
  }
}

/* =========================================================
 * 主要関数：保存（upsert）
 * ========================================================= */

/**
 * OKR を保存（挿入または更新）
 * - okrs テーブルに save（正本）
 * - snapshot 同期形状を構築（呼び出し側で保存）
 * - ★ DB 失敗時は snapshot を更新しない（failure safety）
 *
 * 戻り値：
 * - ResolvedOkr: 保存成功した OKR
 * - snapshot shape は内部計算のみ（呼び出し側で useAutoSave 経由で保存）
 */
export async function upsertOkr(
  input: OkrWriteInput,
  projectId: string,
  companyId: string
): Promise<ResolvedOkr> {
  try {
    // ★ DB 操作を先に実行。失敗したら snapshot を更新しない
    const okrRow = await okrsRepository.upsert(input, companyId);

    // ★ 成功した場合だけ snapshot shape を計算
    // ただし Service 層は保存しない（呼び出し側に委ねる）
    await calculateSnapshotShapeForProject(projectId, companyId);

    // 保存結果を ResolvedOkr で返す
    const resolved: ResolvedOkr = {
      ...okrRow,
      source: 'db' as const,
    };

    return resolved;
  } catch (error) {
    // ★ エラー時は snapshot を更新しない（failure safety）
    console.error('[okrService.upsertOkr] error, snapshot unchanged:', error);
    throw error;
  }
}

/* =========================================================
 * 主要関数：削除（soft delete）
 * ========================================================= */

/**
 * OKR を削除（soft delete）
 * - is_deleted = true に更新
 * - snapshot から確実に除去
 * - ★ DB 失敗時は snapshot を更新しない（failure safety）
 *
 * 設計：
 * - soft delete なので物理削除はしない（ロールバック可能）
 * - snapshot 側の同じ id は再採用しない（merge で除外）
 */
export async function deleteOkr(
  okrId: string,
  projectId: string,
  companyId: string
): Promise<void> {
  try {
    // ★ DB 操作を先に実行。失敗したら snapshot を更新しない
    await okrsRepository.softDelete(okrId, companyId);

    // ★ 成功した場合だけ snapshot shape を計算
    // delete 後は対象 OKR を含まない形状で再構築
    await calculateSnapshotShapeForProject(projectId, companyId);
  } catch (error) {
    // ★ エラー時は snapshot を更新しない（failure safety）
    console.error('[okrService.deleteOkr] error, snapshot unchanged:', error);
    throw error;
  }
}

/* =========================================================
 * 主要関数：並べ替え（reorder）
 * ========================================================= */

/**
 * OKR の並び順を更新
 * - 複数 OKR の sort_order を一括更新
 * - snapshot 同期形状を構築
 * - ★ DB 失敗時は snapshot を更新しない（failure safety）
 */
export async function reorderOkrs(
  projectId: string,
  orderedIds: string[],
  companyId: string
): Promise<void> {
  try {
    // ★ DB 操作を先に実行。失敗したら snapshot を更新しない
    const items = orderedIds.map((id, idx) => ({
      id,
      sort_order: idx,
    }));
    await okrsRepository.batchUpdateSortOrder(items, companyId);

    // ★ 成功した場合だけ snapshot shape を計算
    await calculateSnapshotShapeForProject(projectId, companyId);
  } catch (error) {
    // ★ エラー時は snapshot を更新しない（failure safety）
    console.error('[okrService.reorderOkrs] error, snapshot unchanged:', error);
    throw error;
  }
}

/* =========================================================
 * 内部関数：Snapshot 形状計算
 * ========================================================= */

/**
 * ★ 責務分離：Snapshot 形状の計算のみ
 * - okrs テーブルから最新 OKR リストを取得
 * - 新しい snapshot shape を計算
 * - ★ Service 層は store.setDepartments() を呼ばない
 * - ★ 実保存は呼び出し側の useAutoSave / saveStrategyData に委ねる
 *
 * 用途：
 * - upsert/delete/reorder 後に計算（内部用）
 * - 呼び出し側は取得したデータを store/autosave で処理
 *
 * 注意：
 * - DB 操作は既に成功している前提
 * - snapshot は fallback であり、正本は okrs テーブル
 */
async function calculateSnapshotShapeForProject(
  projectId: string,
  companyId: string
): Promise<OKR[] | null> {
  try {
    // 1. okrs テーブルから最新 OKR リストを取得
    const dbOkrs = await okrsRepository.queryByProjectId(projectId, companyId);

    // 2. snapshot OKR shape を構築（DB 内容で上書き対象）
    const newOkrs: OKR[] = dbOkrs.map((okr) => ({
      id: okr.id,
      objective: okr.objective,
      keyResults: Array.isArray(okr.key_results_json) ? okr.key_results_json : [],
      owner: okr.owner_name || undefined,
      // その他の legacy フィールドは保持（互換性）
    }));

    // ★ 重要：Service 層は store に直接書き込まない
    // 呼び出し側で以下のいずれかを実行：
    // - useAutoSave の自動保存に任せる
    // - または UI で store.setDepartments() を呼ぶ
    console.debug(
      `[okrService.calculateSnapshotShapeForProject] computed snapshot shape (${newOkrs.length} okrs)`
    );

    return newOkrs;
  } catch (error) {
    console.error('[okrService.calculateSnapshotShapeForProject] error:', error);
    return null; // 計算失敗時は null（呼び出し側が無視）
  }
}

/* =========================================================
 * 内部関数：Merge ロジック（統一）
 * ========================================================= */

/**
 * OKR ソースのマージ
 * - DB OKR を優先（is_deleted = false のみ）
 * - snapshot のみの OKR を fallback として追加
 * - ★ soft delete 対応：DB で deleted な OKR は snapshot から再採用しない
 * - 重複排除（DB OKR が優先）
 *
 * 重要：
 * - queryByProjectId() は既に is_deleted = false をフィルタしている
 * - 念のため再度フィルタして多重保護（safety）
 */
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // DB OKR マップ（is_deleted = false のみを有効）
  const dbMap = new Map(
    dbOkrs
      .filter((o) => !o.is_deleted) // ★ 多重保護：削除済みは除外
      .map((o) => [o.id, o])
  );

  // ★ 有効な DB OKR のみを converted
  const resolved: ResolvedOkr[] = dbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({
      ...o,
      source: 'db' as const,
    }));

  // ★ Snapshot のみの OKR を追加（fallback）
  // 重要：同じ id が DB 側で soft delete されたら、snapshot から再採用しない
  snapshotOkrs.forEach((snap) => {
    // snap.id が undefined または DB に存在しない場合だけ追加
    if (snap.id && dbMap.has(snap.id)) {
      // DB に有効な同じ id がある → スキップ（DB 優先）
      return;
    }

    // ★ snapshot からのみの OKR を追加
    const fallbackOkr: ResolvedOkr = {
      // OkrRow の必須フィールド（テンプレート）
      id: snap.id || generateOkrId(),
      company_id: '', // ★ fallback OKR は company_id が不詳（Store で補足予定）
      strategy_id: '',
      department_id: '',
      project_id: '',
      objective: snap.objective || '',
      key_results_json: snap.keyResults || [],
      owner_user_id: undefined,
      owner_name: snap.owner || undefined,
      status: 'draft' as const,
      sort_order: 0,
      source_stage: 'migration' as const,
      source_okr_id: snap.id || undefined,
      is_deleted: false,
      meta_json: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // 重要：source フィールドで snapshot であることを明示
      source: 'snapshot' as const,
    };
    resolved.push(fallbackOkr);
  });

  return {
    resolved,
    stats: {
      dbCount: dbOkrs.length,
      snapshotCount: snapshotOkrs.length,
      mergedCount: resolved.length,
      snapshotOnlyCount: resolved.filter((r) => r.source === 'snapshot').length,
    },
  };
}

/* =========================================================
 * Helper 関数
 * ========================================================= */

/**
 * strategy_data から projectId でプロジェクトを検索
 *
 * ★ 重要（Phase 2A）：
 * - Project.id で一致するものだけを探す
 * - title ベース結びつけに戻さない（後方互換性の罠）
 * - projectId が無い場合は null
 *
 * Legacy project（id が無い）:
 * - findProjectInStrategyData は null を返す
 * - resolveProjectsWithOkrs は early return（snapshot-only）
 */
function findProjectInStrategyData(
  strategyData: StrategyData,
  projectId: string | null | undefined,
  departmentId?: string
): any | null {
  if (!projectId) return null;

  const depts = strategyData.departments ?? [];

  for (const dept of depts) {
    // departmentId が指定されている場合はフィルタ
    if (departmentId && dept.id !== departmentId && dept.name !== departmentId) {
      continue;
    }

    // ★ 重要：常に Project.id で比較（title ベース結びつけは禁止）
    const proj = dept.projects?.find((p) => {
      const normalizedId = normalizeProjectId(p);
      return normalizedId === projectId;
    });
    if (proj) return proj;
  }

  return null;
}

/**
 * ★ 削除：calculateSnapshotShapeForProject で store 書込は不要
 * Service 層は形状を計算して返すだけ
 * 実保存は呼び出し側（UI/useAutoSave）で実施
 */

/**
 * OKR ID 生成（fallback 用）
 */
function generateOkrId(): string {
  // nanoid のような lightweight ID、または timestamp 基盤
  return `okr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/* =========================================================
 * Export: namespace または個別関数
 * ========================================================= */

export const okrService = {
  resolveProjectsWithOkrs,
  resolveAllProjectsWithOkrs,
  upsertOkr,
  deleteOkr,
  reorderOkrs,
  mergeOkrSources,
};

export default okrService;
