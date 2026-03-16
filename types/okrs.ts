/* =========================================================
 * OKR 型定義（Phase 2A 正本化対応）
 * =========================================================
 *
 * 目的：
 * - okrs テーブル（正本）との型安全な相互作用
 * - snapshot（fallback）との融合
 * - source tracking で DB / snapshot を区別
 *
 * ★ 層別型設計:
 * - OkrRow: DB テーブル行型（JSONB フィールド含む）
 * - OkrWriteInput: UI → DB への入力型（Repository 層で変換）
 * - ResolvedOkr: resolveProjectsWithOkrs() 戻り値（source フィールド付き）
 * ========================================================= */

import type { OKR } from './strategy';

/**
 * UUID 型エイリアス
 */
export type UUID = string;

/* =========================================================
 * OkrRow: Supabase okrs テーブル行型（DB primary source）
 * ========================================================= */

export type OkrRow = {
  // Primary key & company scoping
  id: UUID;
  company_id: UUID;

  // OKR relationship
  strategy_id: UUID;
  department_id: string;  // TEXT ベース（Phase 2A）、stable ID 必須
  project_id: string;     // TEXT ベース（Phase 2A）、stable ID 必須

  // OKR content
  objective: string;
  key_results_json: string[] | any[];  // JSONB で KR 配列を保存

  // Ownership
  owner_user_id?: UUID | null;         // DB 側は UUID推奨
  owner_name?: string | null;          // KPI担当の表示名

  // Status & ordering
  status: 'draft' | 'active' | 'completed' | 'archived';
  sort_order: number;                  // プロジェクト内での並び順

  // Migration tracking
  source_stage: 'stage3' | 'stage4' | 'stage5' | 'migration';
  source_okr_id?: string | null;       // レガシー okr.id 参照（backfill 用）

  // Soft delete（削除後の復活防止）
  is_deleted: boolean;

  // Audit & metadata
  meta_json: Record<string, any>;
  created_at: string;                  // ISO 8601 timestamp
  updated_at: string;                  // ISO 8601 timestamp
  created_by?: UUID | null;
  updated_by?: UUID | null;
};

/* =========================================================
 * OkrWriteInput: UI → Repository への入力型
 * （DBの UUID 型を UI 文字列型に変換）
 * ========================================================= */

export type OkrWriteInput = {
  // Optional: 既存 OKR の更新時に指定
  id?: string;

  // 親リソース（Repository で確保）
  company_id?: string;
  strategy_id: string;
  department_id: string;
  project_id: string;

  // Content
  objective: string;
  key_results_json?: string[] | any[];

  // Ownership（UI から文字列で受け取る）
  owner_user_id?: string | null;
  owner_name?: string | null;

  // Status
  status?: 'draft' | 'active' | 'completed' | 'archived';
  sort_order?: number;

  // Metadata
  source_stage?: 'stage3' | 'stage4' | 'stage5' | 'migration';
  source_okr_id?: string | null;
  is_deleted?: boolean;
  meta_json?: Record<string, any>;
};

/* =========================================================
 * ResolvedOkr: resolveProjectsWithOkrs() 戻り値型
 * （source フィールドで DB / snapshot を区別）
 * ========================================================= */

export type ResolvedOkr = OkrRow & {
  /**
   * OKR の由来を明示
   * - 'db': okrs テーブルから取得（正本）
   * - 'snapshot': strategy_data.snapshot から取得（fallback）
   */
  source: 'db' | 'snapshot';
};

/* =========================================================
 * ProjectWithResolvedOkrs: resolveProjectsWithOkrs() の戻り値
 * ========================================================= */

export type ProjectWithResolvedOkrs = {
  // Project 情報（strategy_data から）
  id?: string | number;
  title: string;
  reason?: string;
  okrs?: OKR[];              // 互換性のため保持
  kpis?: string[];
  okrsV2?: any[];
  // ... 他の Project フィールド（必要に応じて拡張）

  // Phase 2A: 解決済み OKR リスト（DB優先、snapshot fallback）
  resolvedOkrs: ResolvedOkr[];
};

/* =========================================================
 * OkrMergeResult: merge ロジックの結果型
 * ========================================================= */

export type OkrMergeResult = {
  /**
   * 統合済み OKR リスト
   * - DB 優先でマージ
   * - snapshot のみの OKR は source='snapshot' で追加
   */
  resolved: ResolvedOkr[];

  /**
   * マージ統計（debug 用）
   */
  stats: {
    dbCount: number;
    snapshotCount: number;
    mergedCount: number;
    snapshotOnlyCount: number;
  };
};

/* =========================================================
 * OkrSyncSnapshot: snapshot 同期後の状態
 * ========================================================= */

export type OkrSyncSnapshot = {
  /**
   * strategy_data.snapshot へ書き込む OKR 配列
   * （DB の okrs テーブルから最新値を取得）
   */
  okrs: Array<{
    id?: string;
    objective: string;
    keyResults: string[] | any[];
    owner?: string;           // owner_name の値（命名注意）
    // ... 他の互換フィールド
  }>;

  /**
   * 同期のメタデータ
   */
  syncedAt: string;           // ISO timestamp
  count: number;              // 同期件数
};

/* =========================================================
 * Migration & Backfill Helper Types
 * ========================================================= */

/**
 * Backfill スクリプトの入力（strategy_data から okrs へ）
 */
export type BackfillOkrData = {
  company_id: UUID;
  strategy_id: UUID;
  department_id: string;
  project_id: string;
  okr_id: string;
  objective: string;
  key_results_json: any[];
  owner_user_id?: UUID | null;
  owner_name?: string | null;
  source_okr_id?: string;
  created_at: string;
};

/**
 * Backfill 進捗レポート
 */
export type BackfillReport = {
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  totalToMigrate: number;
  migratedCount: number;
  failedCount: number;
  startedAt?: string;
  completedAt?: string;
  errorDetails?: string[];
};

/* =========================================================
 * DEBUG API 用の型
 * ========================================================= */

export type OkrDebugInfo = {
  okrsTableCount: number;
  strategyDataOkrsCount: number;
  syncStatus: 'ok' | 'drifting' | 'error';
  recentUpdates: Array<{
    id: string;
    objective: string;
    updated_at: string;
    source_stage: string;
  }>;
  orphanedOkrs: Array<{
    id: string;
    project_id: string;
  }>;
};
