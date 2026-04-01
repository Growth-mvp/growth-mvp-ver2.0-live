// /app/cascade/page.tsx（STAGE3 完成版・KPI表記統一＋人的投資セクション対応）
// ※ユーザー提示コードを「削らず」ベースに、/api/generate-cascade の 2レーン（existing/new）を取り込み
//   - 既存機能（タブ/追加/削除/保存/部門生成/QuestionStepper/KPI簡易編集）を維持
//   - 生成結果が lanes.existing / lanes.new を返す場合、両方をマージして projects に反映（既存UIが壊れない）
//   - さらに「レーン別の表示（参考表示）」を部門カード内に追加（保存モデルは変えず、このページ内で保持）
//
// 重要：types/strategy.ts の Project/Department に lanes フィールドを追加していない前提で、
//       このページ内の ref に保持する方式にしています（store/DBを壊しません）。
//
// ★今回の最適化/修正ポイント（ページ内で完結・DB/Store型は壊さない）
// 1) 再生成のたびにプロジェクトが増殖しないよう「タイトル正規化」による idempotent merge を実装
// 2) new lane が返す expectedImpactYen / probability を OKRに保持（UIで編集しても落ちない）
// 3) 送信payloadにも expectedImpactYen / probability があれば含める（AI側の文脈維持に効く）
// 4) 「今後使わない可能性が高い」未使用のコード/状態は削除（ただし既存機能は維持）
//
// ★今回の削除（依頼対応）
// - 「AIで全社のたたき台（ミッション・プロジェクト・KPI案）」機能を削除
// - 「勝ち筋カタログからプロジェクト＆KPI案」機能を削除
// ※その他の機能（部門ごとのAIたたき台生成、QuestionStepper、KPI簡易編集、人的投資、保存/追加/削除等）は維持

'use client';

// ★ 診断1: 実行中のファイル確認
if (typeof window !== 'undefined') {
  console.log('CASCADE_REAL_FILE_LOADED', { timestamp: new Date().toISOString() });
}

import StrategyGuard from '@/app/StrategyGuard';
import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import SaveStatusIndicator from '@/components/SaveStatusIndicator';
import DepartmentQuestionStepper, {
  type DeptAnswerStep,
  type StepNumber,
  type OKR as DeptOKR,
} from '@/components/guide/QuestionStepper.dept';
import { Button } from '@/components/ui/button';
import { PlusCircle, Save, Sparkles, Building2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toProbability } from '@/types/strategy';

import { useAutoSave } from '@/hooks/useAutoSave';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { getStage2ValueDriverKPIs, getStage2TargetRanges, getStage2WinPatterns } from '@/utils/stage2Selectors';
import { formatMillion, safeRatio, formatPct, inferScaleToMillion } from '@/utils/unit';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { okrsV2ToOkrs, okrsToKpis } from '@/utils/supabase/strategy';
import { mkKRStructured } from '@/app/okr/_lib/okrModels';

import type {
  Department as BaseDepartment,
  Project as BaseProject,
  OKR as BaseOKR,
  ChapterAnswers as BaseChapterAnswers,
  AnswerStep as BaseAnswerStep,
  HumanInvestment,
  HumanInvestmentCategory,
  HumanInvestmentHorizon,
  SkillRequirements,
  StrategyData,
} from '@/types/strategy';

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/* =========================
   型（store拡張互換）
========================= */
// プロジェクトの「仮説メタデータ」
type Lever = 'ACQ' | 'ARPU' | 'CHURN' | 'COST' | 'EFFICIENCY' | 'FUTURE';
type Horizon = 'short' | 'mid' | 'long';
type Kind = 'growth' | 'cost' | 'efficiency' | 'future';

type Project = BaseProject & {
  hypothesis?: string;
  mainLever?: Lever;
  horizon?: Horizon;
  kind?: Kind;
};

// ★ expectedImpactYen / probability を失わないためにページ内ローカルで拡張
type StoreOKR = BaseOKR & {
  expectedImpactYen?: number;
  probability?: number;
  // 将来、APIが title を添える可能性に備えて保持（落とさない）
  title?: string;
};

type StoreAnswerStep = BaseAnswerStep;
type StoreChapterAnswers = BaseChapterAnswers;

type Department = BaseDepartment & {
  mission?: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  answers2?: StoreChapterAnswers[];
  finalized?: boolean;
  generationMeta?: {
    existingCount?: number;
    newCount?: number;
    totalCount?: number;
    updatedAt?: string;
  };
};

/* =========================
   /api/generate-cascade（2レーン互換）
========================= */
type ApiProjectDraft = {
  title?: string;
  hypothesis?: string;
  mainLever?: any;
  horizon?: any;
  kind?: any;

  // 追加フィールドが来ても無害
  reason?: string;
  description?: string;

  // skill/human を受け取る可能性（anyで無害に保持）
  skillRequirements?: any;
  humanInvestments?: any;
};

type ApiOKRDraft = {
  objective?: string;
  keyResults?: any[];
  owner?: string;

  // new lane で来る可能性
  expectedImpactYen?: number;
  probability?: number;

  // 追加で来ても無害
  title?: string; // API側が将来 project title を添える可能性に備える
};

type ApiLane = {
  projects?: ApiProjectDraft[];
};

type ApiDeptDraft = {
  name?: string;
  missionDraft?: string;
  missionDescription?: string; // ★ P1/P0拡張：部門ミッション説明

  // 旧形式
  projects?: ApiProjectDraft[];

  // 新形式（2レーン）
  lanes?: {
    existing?: ApiLane;
    new?: ApiLane;
  };

  // その他
  needsCollab?: string[];
  stopList?: string[];
  first90Days?: string[];
  riskNotes?: string[];
};

type ApiCascadeResponse = {
  strategy?: { summary?: string };
  departments?: ApiDeptDraft[];
  error?: string;
};

/* =========================
   レバー/時間軸ラベル
========================= */
const LEVER_LABEL: Record<Lever, string> = {
  ACQ: 'ACQ（顧客数）',
  ARPU: 'ARPU（単価）',
  CHURN: 'CHURN（解約/離脱）',
  COST: 'COST（コスト）',
  EFFICIENCY: 'EFFICIENCY（生産性）',
  FUTURE: 'FUTURE（将来の種）',
};

const HORIZON_LABEL: Record<Horizon, string> = {
  short: '短期（〜1年）',
  mid: '中期（1〜3年）',
  long: '長期（3年以上）',
};

const KIND_LABEL: Record<Kind, string> = {
  growth: '成長（売上/LTV）',
  cost: 'コスト削減',
  efficiency: '業務効率',
  future: '将来への投資',
};

/* =========================
   安定ID生成（title→id）
========================= */
/**
 * タイトルから安定ID を生成（同じタイトル→同じID）
 * - title が変わらない限り ID は変わらない
 * - 削除・キー・復元に使用可能
 */
function genIdByTitle(title: string, deptName?: string): string {
  const normalized = `${deptName || ''}::${title}`.trim().toLowerCase();
  // 簡易 hash（本番なら crypto.subtle.digest）
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `proj-${Math.abs(hash).toString(36)}`;
}

/**
 * Project の安定ID を解決（既存データ未付与対応）
 * - project.id があれば使用
 * - なければ genIdByTitle で生成（title ベース）
 * - 削除・照合に使用
 */
function resolveProjectId(p: Project, deptName?: string): string {
  return (p as any).id || genIdByTitle(p.title || '', deptName);
}

const LEVER_VALUES: Lever[] = ['ACQ', 'ARPU', 'CHURN', 'COST', 'EFFICIENCY', 'FUTURE'];
const HORIZON_VALUES: Horizon[] = ['short', 'mid', 'long'];
const KIND_VALUES: Kind[] = ['growth', 'cost', 'efficiency', 'future'];

const normalizeLever = (v: any): Lever | undefined => (LEVER_VALUES.includes(v as Lever) ? (v as Lever) : undefined);
const normalizeHorizon = (v: any): Horizon | undefined =>
  HORIZON_VALUES.includes(v as Horizon) ? (v as Horizon) : undefined;
const normalizeKind = (v: any): Kind | undefined => (KIND_VALUES.includes(v as Kind) ? (v as Kind) : undefined);

/* =========================
   ユーティリティ
========================= */
const escapeHtml = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

const nl2brSafe = (s?: string) => (s ? escapeHtml(s).replace(/\r?\n/g, '<br>') : '');

// 部門名プレフィックスを表示・保存の両方で除去（例：「営業部：◯◯」「営業部 - ◯◯」）
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripDeptPrefix = (text: string, deptName: string) => {
  const t = String(text ?? '');
  const dn = String(deptName ?? '').trim();
  if (!dn) return t.trim();
  const re = new RegExp(`^\\s*${escapeRegExp(dn)}\\s*[：:｜|\-–—]\\s*`);
  return t.replace(re, '').trim();
};

const stripDeptPrefixDeep = <T,>(input: T, deptName: string): T => {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return stripDeptPrefix(v, deptName);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(obj)) {
        // key 自体が部門名で始まるケースにも対処（稀）
        const nk = typeof k === 'string' ? stripDeptPrefix(k, deptName) : k;
        out[nk] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
};

/* ==========================================
   KPI ラベル抽出ユーティリティ
========================================== */
type KRLike =
  | string
  | { label?: string | null; name?: string | null; title?: string | null }
  | null
  | undefined;

function toKrLabel(kr: KRLike): string | null {
  if (!kr) return null;
  if (typeof kr === 'string') return kr.trim() || null;
  const v = (kr.label ?? kr.name ?? kr.title ?? '').toString().trim();
  return v || null;
}

function getProjectKpiLabels(p: any): string[] {
  // ★ 修正：okrsV2を優先（新しいシステムの正本）
  // okrsV2が存在する場合はそれを使用、なければ okrs[0].keyResults にフォールバック
  let raw: any[] | null = null;

  // 1. okrsV2 から読む（最新データ）
  if (Array.isArray(p?.okrsV2) && p.okrsV2.length > 0) {
    raw = p.okrsV2;
  }
  // 2. フォールバック：okrs[0].keyResults から読む
  else {
    const okr0 = p?.okrs?.[0];
    raw =
      okr0?.keyResults ??
      okr0?.key_results ??
      okr0?.krs ??
      p?.keyResults ??
      p?.kpis ??
      p?.metrics ??
      null;
  }

  if (!Array.isArray(raw)) return [];

  // ★ 重要：toKrLabel() の結果は null になりうるので、その後の filter を適切に処理
  // 空のラベルも表示対象にしたい場合は filter を調整
  const labeled = raw.map((kr, idx) => {
    const label = toKrLabel(kr);
    // 空文字列は "(未入力)" と表示
    return label || `(未入力)`;
  });

  return labeled.filter(x => x !== null) as string[];
}

/* ==========================================
   KPI表示用ユーティリティ（object → string 変換）
========================================== */
const toDisplayText = (x: any): string => {
  // 文字列：そのまま返す
  if (typeof x === 'string') return x;

  // null/undefined：空文字
  if (x == null) return '';

  // 数値/真偽値：文字列化
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);

  // オブジェクト：フィールド抽出（label → name → title → text → JSON）
  if (typeof x === 'object') {
    const extracted = x.label ?? x.name ?? x.title ?? x.text;
    if (extracted) return String(extracted);
    return JSON.stringify(x);
  }

  // その他：文字列化
  return String(x ?? '');
};

/* ==========================================
   4章 + P/L グラフ用ユーティリティ
========================================== */
const formatYenCompact = (n?: number | null) => {
  if (typeof n !== 'number' || !isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1)}億`;
  if (abs >= 1_0000) return `${(n / 1_0000).toFixed(1)}万`;
  return `${Math.round(n)}`;
};

/* ==========================================
   KPI橋渡し用データ計算（現状 vs 目標）
========================================== */

type KPIBridgeData = {
  revenue: { current: number | null; target: number | null };
  operatingProfit: { current: number | null; target: number | null };
};

function computeKpiBridgeDataLocal({
  financePL,
  csvFinanceData,
  financeSummary,
  targetRanges,
  companyTargets,
}: {
  financePL?: any;
  csvFinanceData?: any;
  financeSummary?: any;
  targetRanges?: any;
  companyTargets?: any[];
}): KPIBridgeData {
  // 数値変換ヘルパ
  const safeNum = (v: any): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // キー揺れ対応
  const pick = (row: any, keys: string[]): any => {
    for (const k of keys) {
      const v = row?.[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };

  // 現状値：最新年の row を1つ選ぶ
  let currentRevenue: number | null = null;
  let currentOpProfit: number | null = null;

  const getLatestRow = (arr: any[]): any => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // 最後の要素を「最新」と仮定
    return arr[arr.length - 1];
  };

  // 1) financePL 最優先
  let latestRow = getLatestRow(Array.isArray(financePL) ? financePL : []);
  if (latestRow) {
    currentRevenue = safeNum(pick(latestRow, ['revenue', '売上', 'sales', 'salesRevenue', 'sales_revenue']));
    currentOpProfit = safeNum(
      pick(latestRow, [
        'opProfit',
        'operatingProfit',
        'operating_profit',
        'operatingIncome',
        'operating_income',
        '営業利益',
        'op',
      ])
    );
  }

  // 2) financeSummary フォールバック
  if (currentRevenue === null) {
    latestRow = getLatestRow(Array.isArray(financeSummary) ? financeSummary : []);
    if (latestRow) {
      currentRevenue = safeNum(pick(latestRow, ['revenue', '売上', 'sales', 'salesRevenue', 'sales_revenue']));
      currentOpProfit = safeNum(
        pick(latestRow, [
          'opProfit',
          'operatingProfit',
          'operating_profit',
          'operatingIncome',
          'operating_income',
          '営業利益',
          'op',
        ])
      );
    }
  }

  // 3) csvFinanceData フォールバック
  if (currentRevenue === null) {
    latestRow = getLatestRow(Array.isArray(csvFinanceData) ? csvFinanceData : []);
    if (latestRow) {
      currentRevenue = safeNum(pick(latestRow, ['revenue', '売上', 'sales', 'salesRevenue', 'sales_revenue']));
      currentOpProfit = safeNum(
        pick(latestRow, [
          'opProfit',
          'operatingProfit',
          'operating_profit',
          'operatingIncome',
          'operating_income',
          '営業利益',
          'op',
        ])
      );
    }
  }

  // 目標値：targetRanges から、またはフォールバック companyTargets から
  let targetRevenue: number | null = null;
  let targetOpProfit: number | null = null;

  // 優先順位1: targetRanges.high から
  if (targetRanges?.high) {
    targetRevenue = safeNum(pick(targetRanges.high, ['revenue', '売上', 'sales', 'salesRevenue', 'sales_revenue']));
    targetOpProfit = safeNum(
      pick(targetRanges.high, [
        'opProfit',
        'operatingProfit',
        'operating_profit',
        'operatingIncome',
        'operating_income',
        '営業利益',
        'op',
      ])
    );
  }

  // 優先順位2: companyTargets から（label マッチで抽出、STAGE2と同じ方式）
  if ((targetRevenue === null || targetOpProfit === null) && Array.isArray(companyTargets) && companyTargets.length > 0) {
    for (const target of companyTargets) {
      const lbl = (target.label ?? '').toLowerCase();

      // 売上マッチ
      if (targetRevenue === null) {
        const isRevenueLabel = ['売上', 'revenue', 'sales', '営業収益'].some(k => lbl.includes(k.toLowerCase()));
        if (isRevenueLabel) {
          const valNum = safeNum(pick(target, ['base']));
          if (valNum !== null) {
            targetRevenue = valNum;
          }
        }
      }

      // 営業利益マッチ
      if (targetOpProfit === null) {
        const isOpLabel = ['営業利益', 'operating profit', 'op', 'opprofit'].some(k => lbl.includes(k.toLowerCase()));
        if (isOpLabel) {
          const valNum = safeNum(pick(target, ['base']));
          if (valNum !== null) {
            targetOpProfit = valNum;
          }
        }
      }

      if (targetRevenue !== null && targetOpProfit !== null) break;
    }
  }

  // ★ Phase 1: Normalize Now/Target values using inferScaleToMillion
  const chartRevenueNow = inferScaleToMillion(currentRevenue)?.converted ?? currentRevenue;
  const chartOpNow = inferScaleToMillion(currentOpProfit)?.converted ?? currentOpProfit;
  const chartRevenueTarget = inferScaleToMillion(targetRevenue)?.converted ?? targetRevenue;
  const chartOpTarget = inferScaleToMillion(targetOpProfit)?.converted ?? targetOpProfit;

  return {
    revenue: { current: chartRevenueNow, target: chartRevenueTarget },
    operatingProfit: { current: chartOpNow, target: chartOpTarget },
  };
}

/* ==========================================
   PositiveOnlyBarCard: 売上用（正の値のみ）
========================================== */
function PositiveOnlyBarCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  const safeMax = Math.max(current ?? 0, target ?? 0, 1);
  const currentHeightPct = current !== null ? (current / safeMax) * 100 : 0;
  const targetHeightPct = target !== null ? (target / safeMax) * 100 : 0;
  const achievementRate = safeRatio(current, target);
  const delta = current !== null && target !== null ? target - current : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5 backdrop-blur-sm p-5">
      {/* タイトル + 単位 */}
      <div className="flex items-center justify-between mb-4">
        <h5 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h5>
        <span className="text-xs text-gray-500 dark:text-gray-400">百万円</span>
      </div>

      {/* 棒グラフ（高さ h-48 = 192px で % が成立） */}
      <div className="relative h-48 flex items-end justify-center gap-6 mb-4">
        {/* 現状 */}
        <div className="flex flex-col items-center gap-2 h-full">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="bg-slate-600 dark:bg-slate-400 rounded-t transition-all shadow-md"
              style={{
                width: '22px',
                height: `${Math.max(currentHeightPct, 2)}%`,
              }}
            />
          </div>
          {current !== null && (
            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-center whitespace-nowrap">
              {formatMillion(current)}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-500">現状</div>
        </div>

        {/* 目標 */}
        <div className="flex flex-col items-center gap-2 h-full">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="bg-blue-500 dark:bg-blue-400 rounded-t transition-all shadow-md"
              style={{
                width: '22px',
                height: `${Math.max(targetHeightPct, 2)}%`,
              }}
            />
          </div>
          {target !== null && (
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 text-center whitespace-nowrap">
              {formatMillion(target)}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-500">目標</div>
        </div>
      </div>

      {/* 下段：差分・達成率 */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>
          差分: {delta !== null ? formatMillion(delta) : '—'}
        </span>
        <span>
          達成率: {achievementRate !== null ? formatPct(achievementRate) : '—'}
        </span>
      </div>
    </div>
  );
}

/* ==========================================
   DivergingBarCard: 営業利益用（負の値対応、0ライン中心）
========================================== */
function DivergingBarCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  const absMax = Math.max(Math.abs(current ?? 0), Math.abs(target ?? 0), 1);
  const currentHeightPct = current !== null ? Math.abs(current) / absMax * 100 : 0;
  const targetHeightPct = target !== null ? Math.abs(target) / absMax * 100 : 0;
  const achievementRate = target !== null && target > 0 ? safeRatio(current, target) : null;
  const delta = current !== null && target !== null ? target - current : null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-white/5 backdrop-blur-sm p-5">
      {/* タイトル */}
      <div className="flex items-center justify-between mb-4">
        <h5 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h5>
        <span className="text-xs text-gray-500 dark:text-gray-400">百万円</span>
      </div>

      {/* 0ライン中心の棒グラフ */}
      <div className="relative h-48 flex justify-center gap-8 mb-4">
        {/* 0ライン */}
        <div
          className="absolute left-0 right-0 h-px bg-gray-400 dark:bg-gray-600"
          style={{ top: '50%' }}
        />

        {/* 現状 */}
        <div className="relative w-12 flex flex-col items-center">
          {/* + 側（上側50%） */}
          {current !== null && current > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="bg-emerald-600 dark:bg-emerald-400 rounded-t transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(currentHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(current)}
              </div>
            </div>
          )}

          {/* - 側（下側50%） */}
          {current !== null && current < 0 && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-start"
              style={{ height: '50%' }}
            >
              <div
                className="bg-red-500 dark:bg-red-400 rounded-b transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(currentHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-red-700 dark:text-red-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(current)}
              </div>
            </div>
          )}

          <div className="absolute -bottom-6 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
            現状
          </div>
        </div>

        {/* 目標 */}
        <div className="relative w-12 flex flex-col items-center">
          {/* + 側（上側50%） */}
          {target !== null && target > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="bg-blue-600 dark:bg-blue-400 rounded-t transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(targetHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(target)}
              </div>
            </div>
          )}

          {/* - 側（下側50%） */}
          {target !== null && target < 0 && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-start"
              style={{ height: '50%' }}
            >
              <div
                className="bg-orange-500 dark:bg-orange-400 rounded-b transition-all shadow-md"
                style={{
                  width: '22px',
                  height: `${Math.max(targetHeightPct, 2)}%`,
                }}
              />
              <div className="text-xs font-semibold text-orange-700 dark:text-orange-300 mt-1 text-center whitespace-nowrap">
                {formatMillion(target)}
              </div>
            </div>
          )}

          <div className="absolute -bottom-6 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
            目標
          </div>
        </div>
      </div>

      {/* 下段：差分・達成率 */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>
          差分: {delta !== null ? formatMillion(delta) : '—'}
        </span>
        <span>
          達成率: {achievementRate !== null ? formatPct(achievementRate) : '—'}
        </span>
      </div>
    </div>
  );
}

/* ==========================================
   4章 + KPI 2点比較コンポーネント
========================================== */
const StoryWithKPIComparison = memo(function StoryWithKPIComparison({
  chapters,
  revenue,
  operatingProfit,
}: {
  chapters: { title: string; body: string }[];
  revenue: { current: number | null; target: number | null };
  operatingProfit: { current: number | null; target: number | null };
}) {
  return (
    <section className="mb-8">
      {/* 4章 */}
      {chapters.length ? (
        <div className="grid md:grid-cols-2 gap-4">
          {chapters.slice(0, 4).map((ch: { title: string; body: string }, i: number) => (
            <div key={i} className="p-4 border rounded-2xl bg-white/60 backdrop-blur-sm">
              <h3 className="font-semibold">{ch.title}</h3>
              <div
                dangerouslySetInnerHTML={{ __html: nl2brSafe(ch.body) }}
                className="text-sm text-zinc-700 mt-1"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-xl border border-yellow-200">
          経営ストーリーが未設定です。先に STAGE 2 で「最終ストーリー」を作成してください。
        </div>
      )}

      {/* KPI 2点比較（2カード） */}
      <div className="mt-5">
        <div className="grid md:grid-cols-2 gap-4">
          <PositiveOnlyBarCard title="売上" current={revenue.current} target={revenue.target} />
          <DivergingBarCard title="営業利益" current={operatingProfit.current} target={operatingProfit.target} />
        </div>
      </div>
    </section>
  );
});


const safeJsonFromText = <T = any>(raw: string): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        // ignore
      }
    }
  }
  return null;
};

const jsonEq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ★ タイトル正規化（重複/増殖防止）
const normalizeTitleKey = (t: string) =>
  (t ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/* ========== AI枠識別・ユーザー化 ========== */
/** ★重要: AI枠判定は generatedGroup も必須（他機能や旧データとの混同防止） */
function isAiGeneratedProject(project: Project): boolean {
  return (project as any).generatedBy === 'ai' && (project as any).generatedGroup === 'cascade_v1';
}

/** AI枠のslot番号を取得 */
function getAiSlot(project: Project): number | undefined {
  return (project as any).generatedSlot;
}

/** Title prefix によるフォールバック判定（meta が保存されない場合の保険） */
function getAiSlotFromTitle(title: string): number | undefined {
  const match = /^\[AI#(\d+)\]/.exec(title);
  return match ? parseInt(match[1], 10) : undefined;
}

/** ユーザープロジェクトに昇格（meta削除 + prefix削除） */
function promoteToUserProject(project: Project): Project {
  const updated = { ...project };
  (updated as any).generatedBy = 'user';
  delete (updated as any).generatedSlot;
  delete (updated as any).generatedGroup;
  delete (updated as any).generatedAt;

  // Title prefix も削除
  if (updated.title) {
    updated.title = updated.title.replace(/^\[AI#\d+\]\s*/, '');
  }

  return updated;
}

/* ストーリー変換 */
const isNonEmptyStoryPayload = (v: any): boolean => {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((c) => (c.title ?? '').trim() || (c.body ?? '').trim());
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
};

function getStory(raw: any) {
  if (Array.isArray(raw) && raw.length) {
    const chapters = raw
      .map((c: any, i: number) => ({
        title: c?.title?.trim() || `Chapter ${i + 1}`,
        body: c?.body ?? '',
      }))
      .filter((c) => c.title.trim() || c.body.trim());
    const text = chapters.map((c, i) => `【第${i + 1}章】${c.title}\n${c.body}`).join('\n\n');
    return { text, chapters };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const lines = text.split(/\r?\n/);
    const chunkSize = Math.max(1, Math.ceil(lines.length / 4));
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += chunkSize) chunks.push(lines.slice(i, i + chunkSize).join('\n'));
    const chapters = chunks.map((body, i) => ({ title: `Chapter ${i + 1}`, body }));
    return { text, chapters };
  }
  return { text: '', chapters: [] };
}

/* 変換 */
const toDeptAnswers = (steps?: StoreAnswerStep[]): DeptAnswerStep[] =>
  (steps ?? []).map((s) => ({
    stepNumber: Number(s.stepNumber) as StepNumber,
    question: s.question ?? '',
    reason: s.reason ?? '',
    answer: s.answer ?? '',
    createdAt: '1970-01-01T00:00:00Z',
  }));

const toStoreSteps = (answers: DeptAnswerStep[]): StoreAnswerStep[] =>
  answers.map((a) => ({
    stepNumber: a.stepNumber,
    question: a.question,
    reason: a.reason,
    answer: a.answer,
  }));

const toStoreOKR = (o: DeptOKR): StoreOKR => ({
  objective: (o.objective ?? '').trim(),
  keyResults: o.keyResults?.filter(Boolean) ?? [],
  owner: o.owner?.trim() || undefined,
});

/* スナップショット＆ハッシュ（Dirty判定） */
function makeSaveSnapshot(s: any) {
  const snap: any = {
    strategyId: s?.strategyId ?? undefined,
    story: Array.isArray(s?.story) ? s.story : [],
    finalStory: Array.isArray(s?.finalStory) ? s.finalStory : [],
    answers2: Array.isArray(s?.answers2) ? s.answers2 : [],
    departments: Array.isArray(s?.departments) ? s.departments : [],
    companyName: s?.companyName,
    mission: s?.mission,
    vision: s?.vision,
    value: s?.value,
    thought: s?.thought,
  };
  if (Array.isArray(s?.csvFinanceData)) snap.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s?.financeSummary)) snap.financeSummary = s.financeSummary;
  if (typeof s?.businessPortfolio !== 'undefined') snap.businessPortfolio = s.businessPortfolio;
  if (typeof s?.simulationResult !== 'undefined') snap.simulationResult = s.simulationResult;
  return snap;
}

function hashSnapshot(obj: any) {
  const s = JSON.stringify(obj ?? {});
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/* =========================
   OKRの品質補正（プレースホルダ除去／重複KRの回避）
========================= */

// 典型的な「ダメObjective」検知
const isBadObjective = (s: string) => {
  const t = (s ?? '').trim();
  if (!t) return true;
  return /数字禁止/.test(t) || /勝ち筋の実装/.test(t) || /構造変化/.test(t) || /placeholder/i.test(t) || /^目的[:：]\s*$/i.test(t);
};

const normalizeKRText = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();

const areAllKRSame = (krs: string[]) => {
  const xs = (krs ?? []).map(normalizeKRText).filter(Boolean);
  if (xs.length <= 1) return false;
  return new Set(xs).size === 1;
};

const buildObjectiveFromProject = (p: { title: string; kind?: Kind; lever?: Lever; horizon?: Horizon }) => {
  const title = (p.title ?? '').trim() || 'このプロジェクト';
  const kind = p.kind ? KIND_LABEL[p.kind] : '';
  const lever = p.lever ? LEVER_LABEL[p.lever] : '';
  const horizon = p.horizon ? HORIZON_LABEL[p.horizon] : '';
  const meta = [kind, lever, horizon].filter(Boolean).join(' / ');

  if (meta) return `「${title}」により、狙う成果（${meta}）が再現性をもって出る状態を確立する`;
  return `「${title}」により、狙う成果が再現性をもって出る状態を確立する`;
};

const buildDistinctKRs = (p: { title: string; lever?: Lever; kind?: Kind; horizon?: Horizon }) => {
  const title = (p.title ?? '').trim() || '当該プロジェクト';
  const lever = p.lever;

  const common = [
    `「${title}」の成功条件（前提・制約・対象範囲）を合意し、実行設計（体制/プロセス/意思決定）を確定する`,
    `「${title}」で追う主要指標（先行指標/遅行指標）と計測手段（データ源/頻度）を確立する`,
    `阻害要因（ボトルネック）を特定し、改善ループ（週次/隔週）を運用開始する`,
  ];

  const byLever: Record<Lever, string[]> = {
    ACQ: [
      `主要ターゲットに対する獲得ファネル（接点→商談→受注）の再現性を作る（定義/導線/責任分界を明確化）`,
      `新規獲得の勝ちパターン（提案骨子/訴求/チャネル）を標準化し、チームに展開する`,
      `獲得ボトルネック（リード質/歩留まり/提案力）を特定し、打ち手を実装する`,
    ],
    ARPU: [
      `価値提供メニュー（アップセル/クロスセル）の設計を確定し、提案可能な状態にする`,
      `価格・条件・提供範囲の意思決定基準を整備し、提案のブレをなくす`,
      `高付加価値顧客セグメントの定義と優先順位を確定し、営業/CSの運用に落とす`,
    ],
    CHURN: [
      `解約/離脱の主要要因を構造化し、予兆指標と介入プロセスを確立する`,
      `オンボーディング/定着の標準プロセスを整備し、品質を均一化する`,
      `重点顧客の継続価値を上げる施策（利用深度/活用支援）を運用開始する`,
    ],
    COST: [
      `コスト構造（固定/変動/原価要因）を可視化し、削減余地の優先順位を確定する`,
      `ムダ工程/重複業務を特定し、廃止・統合・自動化の実装計画を確定する`,
      `外部支出（購買/委託/保守）の見直し方針を定め、交渉/切替を開始する`,
    ],
    EFFICIENCY: [
      `業務の標準手順と責任分界を明確化し、属人性の高い工程を縮小する`,
      `主要業務のリードタイム/品質のボトルネックを特定し、改善サイクルを回す`,
      `データ/ツール/連携の欠損を埋め、現場が迷わず判断できる状態を作る`,
    ],
    FUTURE: [
      `探索テーマの仮説（誰の何の課題をどう解くか）を明確化し、検証計画を確定する`,
      `検証（PoC/試験導入）の成功条件と判断基準を定め、学習を回す`,
      `将来の事業化に向けた要件（収益モデル/提供体制/リスク）を整理し、次アクションに落とす`,
    ],
  };

  const tailored = lever ? byLever[lever] : [];
  const pool = [...tailored, ...common];

  const picked: string[] = [];
  const used = new Set<string>();
  for (const s of pool) {
    const t = normalizeKRText(s);
    if (!t || used.has(t)) continue;
    used.add(t);
    picked.push(s);
    if (picked.length >= 3) break;
  }
  return picked;
};

function sanitizeOkrsForProject(p: Project, okrs: StoreOKR[]): StoreOKR[] {
  const list = Array.isArray(okrs) ? okrs : [];
  if (!list.length) return [];

  // ★ extra fields を落とさないため、コピーは spread のみ（ここが重要）
  const first = { ...(list[0] as StoreOKR) };

  const objective = (first.objective ?? '').trim();
  const krsRaw = (first.keyResults ?? [])
    .map((x: any) => String(x ?? ''))
    .map((x) => x.trim())
    .filter(Boolean);

  if (isBadObjective(objective)) {
    first.objective = buildObjectiveFromProject({
      title: p.title ?? '',
      kind: p.kind,
      lever: p.mainLever,
      horizon: p.horizon,
    });
  }

  const krs = krsRaw;
  if (!krs.length || areAllKRSame(krs)) {
    first.keyResults = buildDistinctKRs({
      title: p.title ?? '',
      lever: p.mainLever,
      kind: p.kind,
      horizon: p.horizon,
    });
  } else {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const kr of krs) {
      const t = normalizeKRText(kr);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      uniq.push(kr);
    }
    first.keyResults = uniq;
  }

  return [first, ...list.slice(1)];
}

/* =========================
   2レーンのマージ（storeは壊さず projects に統合）
   - タイトル正規化で増殖を止める
   - OKRは一切変更しない（手入力扱い）
========================= */

// ★修正（Stage3）: 重複検知・防止用ヘルパー
const DEBUG_DUP = process.env.NEXT_PUBLIC_DEBUG_CASCADE_DUP === '1';

function normTitle(s: string) {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ★ TASK A: OKR/KPI 引き継ぎ用マージ関数
type AnyProj = any;

const mergeCascadeFields = (
  incoming: AnyProj,
  existing?: AnyProj,
  preserveOkrs: boolean = true
): AnyProj => {
  if (!existing) return incoming;

  const incomingOkrs = Array.isArray(incoming.okrs) ? incoming.okrs : [];
  const existingOkrs = Array.isArray(existing.okrs) ? existing.okrs : [];

  const incomingKpis = Array.isArray(incoming.kpis) ? incoming.kpis : [];
  const existingKpis = Array.isArray(existing.kpis) ? existing.kpis : [];

  const incomingOkrsV2 = Array.isArray(incoming.okrsV2) ? incoming.okrsV2 : [];
  const existingOkrsV2 = Array.isArray(existing.okrsV2) ? existing.okrsV2 : [];

  // preserveOkrs=true のときだけ「incomingが空なら existing を引き継ぐ」（ユーザー編集保持）
  // generate-cascade の再生成時は preserveOkrs=false で「置換」を優先（KPI増殖防止）
  const merged = {
    ...existing,
    ...incoming,
    okrs: preserveOkrs ? (incomingOkrs.length > 0 ? incomingOkrs : existingOkrs) : incomingOkrs,
    kpis: preserveOkrs ? (incomingKpis.length > 0 ? incomingKpis : existingKpis) : incomingKpis,
    okrsV2: preserveOkrs
      ? (incomingOkrsV2.length > 0 ? incomingOkrsV2 : existingOkrsV2)
      : incomingOkrsV2,
  };

  return merged;
};

const buildProjectIndexByTitle = (projects: AnyProj[]) => {
  const map = new Map<string, AnyProj>();
  for (const p of Array.isArray(projects) ? projects : []) {
    const key = normTitle(p?.title ?? '');
    if (!key) continue;
    if (!map.has(key)) map.set(key, p);
  }
  return map;
};

function dupStats(titles: string[]) {
  const m = new Map<string, number>();
  for (const t of titles) {
    const k = normTitle(t);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const dups = [...m.entries()].filter(([, c]) => c >= 2);
  return { total: titles.length, unique: m.size, dups: dups.slice(0, 10) };
}

function dedupeProjectsByTitle(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const p of projects ?? []) {
    const k = normTitle(p?.title ?? '');
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function normalizeProjectDraft(pd: ApiProjectDraft, deptName?: string): Project | null {
  const title = (pd?.title ?? '').trim();
  if (!title) return null;

  const hypothesis =
    typeof pd?.hypothesis === 'string'
      ? pd.hypothesis.trim()
      : typeof pd?.description === 'string'
        ? pd.description.trim()
        : undefined;

  // ★ 修正1b: project.id を title から安定生成（title変更後も同一project の追跡可能）
  const projectId = genIdByTitle(title, deptName);

  const p: Project = {
    title,
    hypothesis,
    mainLever: normalizeLever(pd?.mainLever),
    horizon: normalizeHorizon(pd?.horizon),
    kind: normalizeKind(pd?.kind),
  } as any as Project & { id?: string };
  (p as any).id = projectId;

  // ★ TASK A: okrsV2/okrs/kpis を API レスポンスから取り込む（生成結果の永続化）
  const pdOkrsV2 = (pd as any)?.okrsV2;
  if (Array.isArray(pdOkrsV2) && pdOkrsV2.length > 0) {
    (p as any).okrsV2 = pdOkrsV2;
  }

  const pdOkrs = (pd as any)?.okrs;
  if (Array.isArray(pdOkrs) && pdOkrs.length > 0) {
    (p as any).okrs = pdOkrs;
  }

  const pdKpis = (pd as any)?.kpis;
  if (Array.isArray(pdKpis) && pdKpis.length > 0) {
    (p as any).kpis = pdKpis;
  }

  // skillRequirements を API レスポンスから取り込む
  const pdSkills = (pd as any)?.skillRequirements;
  if (pdSkills) (p as any).skillRequirements = pdSkills;

  // humanInvestments を API レスポンスから取り込む
  const pdInvestments = (pd as any)?.humanInvestments;
  if (pdInvestments) (p as any).humanInvestments = pdInvestments;

  return p;
}

// ★ TASK 1: mergeProjectInto に preserveOkrs パラメータを追加
// 再生成時は preserveOkrs=false を渡して、okrs/okrsV2/kpis を incoming で置換
function mergeProjectInto(projects: Project[], incoming: Project, preserveOkrs: boolean = true): Project[] {
  const inKey = normalizeTitleKey(incoming.title ?? '');
  if (!inKey) return projects;

  const existIdx = projects.findIndex((p) => normalizeTitleKey(p.title ?? '') === inKey);
  if (existIdx < 0) return [...projects, incoming];

  const existing = projects[existIdx] as any;

  // ★ TASK 1: Use mergeCascadeFields for okrs/okrsV2/kpis sync
  // Critical: preserveOkrs=false ensures incoming KPI/OKR replaces existing
  const merged = mergeCascadeFields(incoming as any, existing, preserveOkrs) as Project;

  // ★ Merge other fields (hypothesis, mainLever, horizon, kind)
  const mergedWithMetadata: Project = {
    ...merged,
    hypothesis: incoming.hypothesis || merged.hypothesis,
    mainLever: incoming.mainLever || merged.mainLever,
    horizon: incoming.horizon || merged.horizon,
    kind: incoming.kind || merged.kind,
  };

  // ★STAGE4移管：skillRequirements, humanInvestments は STAGE4で編集
  // cascade では既存データを保持するのみ（補完しない）

  const next = [...projects];
  next[existIdx] = mergedWithMetadata;
  return next;
}

// ★修正（Stage3）: applyLaneToProjects を pure function化
// このlaneが生成するプロジェクト配列のみを返す（既存配列への追記禁止）
function applyLaneToProjects(lane?: ApiLane, deptName?: string): Project[] {
  const projectsDraft: ApiProjectDraft[] = Array.isArray(lane?.projects) ? lane!.projects! : [];

  // ★重要：ローカル配列のみで構築（既存の base は参照しない）
  const laneProjects: Project[] = [];

  for (let i = 0; i < projectsDraft.length; i++) {
    const pd = projectsDraft[i];
    const normalized = normalizeProjectDraft(pd, deptName);
    if (!normalized) continue;

    laneProjects.push(normalized);
  }

  return laneProjects;
}

// ★修正（Stage3）: 「置換」ベースに変更
// 3つのレーン結果を集約してから、一度だけ反映する（重複を防止）
function applyDeptDraftToProjects(existingProjects: Project[], deptDraft: ApiDeptDraft, preserveOkrs: boolean = true, deptName?: string): Project[] {
  const beforeCount = existingProjects.length;

  // ★重要：各レーンから生成プロジェクトを集約
  const lane1Projects = Array.isArray(deptDraft.projects) && deptDraft.projects.length
    ? applyLaneToProjects({ projects: deptDraft.projects } as ApiLane, deptName)
    : [];

  const lane2Projects = applyLaneToProjects(deptDraft?.lanes?.existing, deptName);
  const lane3Projects = applyLaneToProjects(deptDraft?.lanes?.new, deptName);

  // ★置換：3つのレーン結果を結合して、最終的なプロジェクト配列を作成
  const nextProjectsRaw = [...lane1Projects, ...lane2Projects, ...lane3Projects];

  // ★保険：重複排除（万が一同じlaneから同名プロジェクトが返されたら）
  const nextProjects = dedupeProjectsByTitle(nextProjectsRaw);

  // ★ 修正：再生成時（preserveOkrs=false）は title ベース merge をしない、from-scratch 置換
  // 再生成時は old project の owner/reason/role/expectedImpactYen 等を引き継がない
  if (preserveOkrs) {
    // ★ 通常編集時：既存PJから OKR/KPI を引き継ぐマージ
    const existingIndex = buildProjectIndexByTitle(existingProjects);
    const nextProjectsMerged = nextProjects.map((p) => {
      const key = normTitle(p?.title ?? '');
      return mergeCascadeFields(p, key ? existingIndex.get(key) : undefined, preserveOkrs);
    });

    // ★ 最終的に deduped されたマージ結果を返す
    const deduped = dedupeProjectsByTitle(nextProjectsMerged);
    return deduped;
  } else {
    // ★ 再生成時（preserveOkrs=false）：from-scratch 置換
    // incoming project のみを使用、old project のフィールドを引き継がない
    // normalizeProjectDraft で取り込まれたフィールド（title/hypothesis/mainLever/okrs 等）のみが残る
    return dedupeProjectsByTitle(nextProjects);
  }
}

/* =========================
   ビジュアルカード（部門戦略の全体像をシンプル表示）
========================= */
const VisualCard = memo(
  function VisualCard({ d, deptIndex, onProjectUpdate }: { d: Department; deptIndex: number; onProjectUpdate?: (deptIndex: number, projIndex: number, ownerName: string) => void }) {
  const mission = (d.strategy ?? d.mission ?? '').trim();

  // ★ STEP 1 修正：source of truth を departments[].projects のみに統一
  // lanes は参考表示に分離（読み取り専用）
  const projects = (d.projects ?? []) as Project[];

  const shortSummary = mission.length > 32 ? mission.slice(0, 32) + '…' : mission;

  // ★ DIAG: render時の render-source 確認（削除後の描画を監視・verbose log削減）
  if (Math.random() < 0.05) {
    console.log('[diag][stage3:delete:post-render-check]', {
      deptName: d.name,
      dept_projects_count: (d.projects ?? []).length,
      dept_lanes_existing: (d as any).lanes?.existing?.projects?.length ?? 0,
      dept_lanes_new: (d as any).lanes?.new?.projects?.length ?? 0,
      rendered_projects_count: projects.length,
      projectTitles: projects.map((p) => p.title),
    });
  }

  return (
    <div className="p-6 rounded-3xl border bg-white/70 backdrop-blur-sm shadow-sm">
      <div className="flex justify-between items-start mb-3 gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-zinc-900">
            <Building2 className="w-4 h-4" />
            {d.name}
          </h3>
          {mission && <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{shortSummary}</p>}
        </div>
        {d.finalized && <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>}
      </div>

      {mission && (
        <div className="mb-4">
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">{mission}</p>
        </div>
      )}

      {projects.length > 0 ? (
        <div>
          <div className="text-xs font-semibold text-zinc-500 mb-1">主なプロジェクトと目標</div>
          <ul className="space-y-3">
            {projects.map((p, i) => {
              const okr = p.okrs?.[0] as StoreOKR | undefined;
              const krs = getProjectKpiLabels(p);

              // ★ UI表示用：[AI#N] prefix を削除（内部的には title に保持）
              const displayTitle = stripDeptPrefix((p.title ?? '').replace(/^\[AI#\d+\]\s*/i, ''), d.name) || '無題のプロジェクト';

              // ★ 修正1e: key を project.id に（title変更後も同一project として追跡）
              const projectKey = resolveProjectId(p, d.name);

              return (
                <li key={projectKey} className="rounded-2xl border bg-white/80 px-3 py-2">
                  <div className="text-sm font-medium text-zinc-900">• {displayTitle}</div>
                  {/* ★ Phase 1: Project owner 編集欄 */}
                  <div className="mt-2 mb-2">
                    <label className="text-[11px] font-semibold text-zinc-700 block mb-1">プロジェクト責任者</label>
                    <input
                      type="text"
                      className="w-full h-8 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-[12px]"
                      placeholder="責任者名"
                      value={p.ownerName ?? ''}
                      onChange={(e) => {
                        onProjectUpdate?.(deptIndex, i, e.target.value);
                      }}
                    />
                  </div>

                  {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                    <div className="mt-1">
                      {p.hypothesis && <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{p.hypothesis}</p>}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                        {p.kind && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{KIND_LABEL[p.kind]}</span>}
                        {p.mainLever && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{LEVER_LABEL[p.mainLever]}</span>
                        )}
                        {p.horizon && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{HORIZON_LABEL[p.horizon]}</span>}
                      </div>
                    </div>
                  )}

                  {okr?.objective && <div className="mt-2 text-xs text-zinc-700">目標：{toDisplayText(stripDeptPrefix(okr.objective, d.name))}</div>}
                  {krs.length > 0 && (
                    <ul className="mt-1 pl-4 space-y-1 list-disc text-xs text-zinc-700">
                      {krs.slice(0, 3).map((kr, idx) => (
                        <li key={idx}>{toDisplayText(stripDeptPrefix(kr, d.name))}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">まだプロジェクトが設定されていません。「編集」タブから追加してください。</p>
      )}
    </div>
  );
  },
  (prevProps, nextProps) => {
    // ★ STEP 1 修正：projects の length のみ比較（lanes は参考表示に分離）
    // ★ Phase 1: deptIndex も比較
    const prevProjectsLen = prevProps.d.projects?.length ?? 0;
    const nextProjectsLen = nextProps.d.projects?.length ?? 0;
    return prevProjectsLen === nextProjectsLen && prevProps.deptIndex === nextProps.deptIndex;
  }
);

/* =========================
   KPI同期ヘルパー
========================= */
/**
 * okrsV2を正本として、okrs と kpis を再生成・同期
 * STAGE3で okrsV2を編集した後、このヘルパーで全表現を統一
 * ★ 重要：okrs[0].owner を保持（KPI担当者が lose されないように）
 */
const syncProjectKrRepresentations = (project: any) => {
  const okrsV2 = Array.isArray(project.okrsV2) ? project.okrsV2 : [];
  const fallbackTitle = String(project.title ?? '改善テーマ');
  const okrs = okrsV2ToOkrs(okrsV2, fallbackTitle);
  const kpis = okrsToKpis(okrs);

  // ★ Bug #3対応：okrs[0].owner を保持（保存/ロード時に失われないように）
  const existingOwner = (project?.okrs as any)?.[0]?.owner;
  if (okrs[0] && existingOwner) {
    (okrs[0] as any).owner = existingOwner;
  }

  return {
    ...project,
    okrsV2,
    okrs,
    kpis,
  };
};

/**
 * KR文字列をminimalなKRStructured に変換
 * @param label KR表示テキスト
 * @param owner オプション：KR担当者を指定
 */
const stringToKRStructured = (label: string, owner?: string) => {
  return mkKRStructured({
    label: label.trim(),
    kind: 'SUCCESS_RATE' as any,
    target: 0,
    unit: '%' as any,
    scope: 'project' as any,
    baseKey: 'success_rate' as any,
    ...(owner ? { owner } : {}),
  });
};

/* =========================
   メイン
========================= */
function CascadePageContent() {
  // ★ 1フィールド = 1購読に分割（shallow 不要）
  const scopeCompanyId = useStrategyStore((st: any) => st.companyId);
  const hydrated = useStrategyStore((st: any) => st.hydrated);
  const setCompanyScope = useStrategyStore((st: any) => st.setCompanyScope);
  const refetchFromServer = useStrategyStore((st: any) => st.refetchFromServer);
  const setHydrated = useStrategyStore((st: any) => st.setHydrated);
  const boot = useStrategyStore((st: any) => st.boot);
  const saveNow = useStrategyStore((st: any) => st.saveStrategyData);
  const lastServerSnapshot = useStrategyStore((st: any) => st.lastServerSnapshot);
  const setDepartmentsInStore = useStrategyStore((st: any) => st.setDepartments);

  const financePL = useStrategyStore((st: any) => st.financePL);
  const csvFinanceData = useStrategyStore((st: any) => st.csvFinanceData);
  const financeSummary = useStrategyStore((st: any) => st.financeSummary);

  const storyDraft = useStrategyStore((st: any) => st.storyDraft);
  const finalStoryDraft = useStrategyStore((st: any) => st.finalStoryDraft);
  const finalStoryEdited = useStrategyStore((st: any) => st.finalStoryEdited);
  const finalStoryFinal = useStrategyStore((st: any) => st.finalStoryFinal);

  const strategyStory = useStrategyStore((st: any) => st.strategyStory);
  const story = useStrategyStore((st: any) => st.story);
  const finalStory = useStrategyStore((st: any) => st.finalStory);
  const departments = useStrategyStore((st: any) => st.departments);
  const strategyId = useStrategyStore((st: any) => st.strategyId);

  const industry = useStrategyStore((st: any) => st.industry);
  const company = useStrategyStore((st: any) => st.company);
  const businessSegments = useStrategyStore((st: any) => st.businessSegments);
  const strategySummary = useStrategyStore((st: any) => st.strategySummary);

  const thought = useStrategyStore((st: any) => st.thought);
  const vision = useStrategyStore((st: any) => st.vision);
  const mission = useStrategyStore((st: any) => st.mission);
  const revenue = useStrategyStore((st: any) => st.revenue);
  const employees = useStrategyStore((st: any) => st.employees);
  const value = useStrategyStore((st: any) => st.value);
  const strength = useStrategyStore((st: any) => st.strength);
  const weakness = useStrategyStore((st: any) => st.weakness);
  const opportunity = useStrategyStore((st: any) => st.opportunity);
  const threat = useStrategyStore((st: any) => st.threat);
  const businessPortfolio = useStrategyStore((st: any) => st.businessPortfolio);

  const access = useAccess();

  /**
   * 重要：useAccess の実装差分に耐えるため
   * - canEditCompany が関数/boolean どちらでも動く
   * - canEditDepartment が関数/boolean どちらでも動く
   */
  const canEditCompany = useMemo(() => {
    const v = (access as any)?.canEditCompany;
    try {
      return typeof v === 'function' ? !!v.call(access) : !!v;
    } catch {
      return false;
    }
  }, [access]);

  const canEditDept = useCallback(() => {
    const v = (access as any)?.canEditDepartment;
    try {
      return typeof v === 'function' ? !!v.call(access) : !!v;
    } catch {
      return false;
    }
  }, [access]);

  const accessCompanyId: string | undefined = useMemo(
    () => ((access as any)?.companyId ?? (scopeCompanyId as string | undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(access as any)?.companyId, scopeCompanyId],
  );

  const industryFinal: string = (industry as string) || (company?.industry as string) || '';

  // ★STAGE2構造化データ取得（セレクタ経由で一本化）
  // Use getState() to avoid circular dependency on the memoized values
  const valueDriverKPIs = useMemo(
    () => getStage2ValueDriverKPIs(useStrategyStore.getState() as StrategyData),
    []
  );
  const targetRanges = useMemo(
    () => getStage2TargetRanges(useStrategyStore.getState() as StrategyData),
    []
  );
  const companyTargets = useMemo(
    () => (useStrategyStore.getState() as any).companyTargets || [],
    []
  );

  /* ===== KPI橋渡しデータ（現状 vs 目標） ===== */
  const kpiBridgeData = useMemo(
    () => computeKpiBridgeDataLocal({ financePL, csvFinanceData, financeSummary, targetRanges, companyTargets }),
    [financePL, csvFinanceData, financeSummary, targetRanges, companyTargets],
  );

  const { primary: winPatternPrimary, secondary: winPatternSecondary } = useMemo(
    () => getStage2WinPatterns(useStrategyStore.getState() as StrategyData),
    []
  );

  /* ---- 初回ログだけ ---- */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 会社スコープ確立（StrictMode耐性）===== */
  const lastAppliedCompanyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (lastAppliedCompanyRef.current === accessCompanyId && scopeCompanyId === accessCompanyId) return;

    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      setHydrated?.(false);
      hardResetForCompanySwitch(accessCompanyId);
      setCompanyScope(accessCompanyId);
    } else if (!scopeCompanyId) {
      setCompanyScope(accessCompanyId);
    }
    lastAppliedCompanyRef.current = accessCompanyId;
  }, [accessCompanyId, scopeCompanyId, setCompanyScope, setHydrated]);

  /* ===== 初期ロード ===== */
  const loadGuardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accessCompanyId) return;
    if (!scopeCompanyId) setCompanyScope(accessCompanyId);
    if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) {
        loadGuardRef.current = accessCompanyId;
        return;
      }

      const currentSnap = makeSaveSnapshot(useStrategyStore.getState());
      const currentHash = hashSnapshot(currentSnap);
      const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

      const timer = setTimeout(() => !cancelled && setHydrated?.(true), 7000);
      try {
        if (!isDirty) {
          await loadAndHydrate(accessCompanyId);
          try {
            await refetchFromServer?.();
          } catch {
            // ignore
          }
          setHydrated?.(true);
        } else {
          setHydrated?.(true);
        }
        loadGuardRef.current = accessCompanyId;
      } catch (err) {
        console.error('[cascade] ❌ loadAndHydrate error (raw):', err);
        const anyErr = err as any;
        console.error('[cascade] ❌ loadAndHydrate error (meta):', {
          name: anyErr?.name,
          message: anyErr?.message,
          code: anyErr?.code,
          details: anyErr?.details,
          status: anyErr?.status,
          stack: anyErr?.stack,
          meta: anyErr?.meta,
        });

        console.warn('[cascade] hydrated=true を強制設定（エラー時UI表示対応）');
        setHydrated?.(true);
        loadGuardRef.current = accessCompanyId;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    accessCompanyId,
    hydrated,
    scopeCompanyId,
    refetchFromServer,
    setHydrated,
    lastServerSnapshot,
    setCompanyScope,
  ]);

  /* ===== ハイドレーション・ウォッチドッグ ===== */
  const hydrateStartRef = useRef<number | null>(null);
  useEffect(() => {
    const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
    const nowHydrating = (boot?.isHydrating && !hydrated) || mismatch;

    if (nowHydrating) {
      if (hydrateStartRef.current == null) hydrateStartRef.current = Date.now();
    } else {
      hydrateStartRef.current = null;
    }

    const id = setInterval(() => {
      if (hydrateStartRef.current != null && Date.now() - hydrateStartRef.current > 5000) {
        setHydrated?.(true);
        hydrateStartRef.current = null;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [boot?.isHydrating, hydrated, accessCompanyId, scopeCompanyId, setHydrated]);

  /* ===== TASK 1: UI が何を見ているかの診断ログ ===== */
  useEffect(() => {
    if (!hydrated) return;

    const d0 = departments?.[0];
    const p0 = d0?.projects?.[0];

  }, [hydrated, departments]);

  /* ===== TASK 2: リロード後に departments から okrs/kpis を復元 ===== */
  useEffect(() => {
    if (!hydrated) return;
    if (!Array.isArray(departments) || departments.length === 0) return;

    // 既に departments に okrs/kpis が入っているか確認
    let hasOkrsOrKpis = false;
    for (const d of departments) {
      for (const p of (d as any).projects ?? []) {
        if ((Array.isArray(p?.okrs) && p.okrs.length > 0) ||
            (Array.isArray(p?.kpis) && p.kpis.length > 0) ||
            (Array.isArray(p?.okrsV2) && p.okrsV2.length > 0)) {
          hasOkrsOrKpis = true;
          break;
        }
      }
      if (hasOkrsOrKpis) break;
    }

    if (!hasOkrsOrKpis) {
      return;
    }

    // kpis がない projects に対して okrs から復元
    const nextDepartments = departments.map((d: any) => {
      const projects = Array.isArray((d as any).projects) ? (d as any).projects : [];

      const updatedProjects = projects.map((p: any) => {
        if (Array.isArray(p?.kpis) && p.kpis.length > 0) {
          // 既に kpis がある
          return p;
        }

        // kpis がない場合、okrs から復元
        if (Array.isArray(p?.okrs) && p.okrs.length > 0) {
          const extractedKpis = [];
          for (const okr of p.okrs) {
            if (Array.isArray(okr?.keyResults)) {
              for (const kr of okr.keyResults) {
                const label = typeof kr === 'string' ? kr : (typeof kr?.label === 'string' ? kr.label : '');
                if (label) extractedKpis.push(label);
              }
            }
          }
          if (extractedKpis.length > 0) {
            return { ...p, kpis: extractedKpis };
          }
        }

        return p;
      });

      return { ...d, projects: updatedProjects };
    });

    // 更新があった場合のみ store に反映
    const hasChanged = nextDepartments.some((d: any, di: number) => {
      const origD = departments[di];
      const origProjs = Array.isArray((origD as any).projects) ? (origD as any).projects : [];
      const nextProjs = Array.isArray(d.projects) ? d.projects : [];
      return origProjs.some((p: any, pi: number) => {
        const nextP = nextProjs[pi];
        const origKpis = Array.isArray(p?.kpis) ? p.kpis : [];
        const nextKpis = Array.isArray(nextP?.kpis) ? nextP.kpis : [];
        return origKpis.length !== nextKpis.length;
      });
    });

    if (hasChanged) {
      setDepartmentsInStore?.(nextDepartments);
    }
  }, [hydrated, departments, setDepartmentsInStore]);

  /* ===== STAGE1事業部名→初期部門展開（One-time import）===== */
  const hasInitializedFromStage1Ref = useRef(false);
  useEffect(() => {
    if (!hydrated || hasInitializedFromStage1Ref.current) return;
    if (departments.length > 0) {
      hasInitializedFromStage1Ref.current = true;
      return;
    }
    if (businessSegments.length === 0) return;

    const initialDepts: Department[] = businessSegments.map((seg: any) => ({
      name: seg?.name || '無題の部門',
      mission: seg?.scope || '',
      strategy: seg?.scope || '',
      missionDraft: '',
      discussionNotes: '',
      projects: [],
      answers2: [{ chapterIndex: 0, chapterTitle: seg?.name || '無題の部門', steps: [] }],
      finalized: false,
      source: 'stage1' as const,
    }));

    setDepartmentsInStore?.(initialDepts);
    hasInitializedFromStage1Ref.current = true;
  }, [hydrated, departments.length, businessSegments, setDepartmentsInStore]);

  const mismatch = !!(accessCompanyId && scopeCompanyId && scopeCompanyId !== accessCompanyId);
  const isHydrating = (Boolean(boot?.isHydrating) && !hydrated) || mismatch;

  const rawStory = useMemo(() => {
  // ★ STAGE2の“確定版/編集版/ドラフト” を最優先
  if (isNonEmptyStoryPayload(finalStoryFinal)) return finalStoryFinal;
  if (isNonEmptyStoryPayload(finalStoryEdited)) return finalStoryEdited;
  if (isNonEmptyStoryPayload(finalStoryDraft)) return finalStoryDraft;

  // 互換：旧フィールド
  if (isNonEmptyStoryPayload(finalStory)) return finalStory;
  if (isNonEmptyStoryPayload(story)) return story;
  if (isNonEmptyStoryPayload(strategyStory)) return strategyStory;

  // 互換：ドラフト
  if (isNonEmptyStoryPayload(storyDraft)) return storyDraft;

  return '';
}, [
  finalStoryFinal,
  finalStoryEdited,
  finalStoryDraft,
  finalStory,
  story,
  strategyStory,
  storyDraft,
]);


  const { text: storyText, chapters: storyChapters } = useMemo(() => getStory(rawStory), [rawStory]);

  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState<Record<number, any>>({});
  // ★TASK A: 生成中フラグ（保存抑止用）
  const [isGenerating, setIsGenerating] = useState(false);

  // ★TASK A: 生成中は autosave を抑止（state定義後に移動）
  useAutoSave({
    enabled: hydrated && !boot?.isHydrating && !isGenerating,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

  /* ===== TASK D: KPI 表示ヘルパー（object → string 変換） ===== */
  const renderKpi = (k: any): string => {
    if (typeof k === 'string') return k;
    if (k && typeof k === 'object') {
      return k.label ?? k.name ?? k.title ?? k.text ?? JSON.stringify(k);
    }
    return String(k ?? '');
  };

  /* ===== レーン表示用の一時キャッシュ（store/DBは変更しない） ===== */
  const laneCacheRef = useRef<Record<string, { existing?: ApiLane; new?: ApiLane }>>({});
  const [showLaneDetail, setShowLaneDetail] = useState<Record<string, boolean>>({});
  const [laneRenderVersion, setLaneRenderVersion] = useState(0);

// ★ lanes 内訳は store/DB に保存しない（既存方針維持）。ただしUI上はリロードで消えると困るため、
// sessionStorage に一時退避して復元します（同一ブラウザ/タブ内での再読み込みに耐える）。
const laneCacheKey = useMemo(
  () => `cascade_lane_cache:${strategyId ?? accessCompanyId ?? 'na'}`,
  [strategyId, accessCompanyId],
);

const persistLaneCache = useCallback(() => {
  try {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(laneCacheKey, JSON.stringify(laneCacheRef.current ?? {}));
  } catch {
    // ignore
  }
}, [laneCacheKey]);

useEffect(() => {
  const convertDeptLanes = (deptLanes?: Department['lanes']) => {
    if (!deptLanes) return undefined;

    const existingProjects = Array.isArray(deptLanes.existing?.projects)
      ? deptLanes.existing!.projects!.map((p: any) => ({
          title: p?.title ?? '',
          mainLever: p?.mainLever,
          horizon: p?.horizon,
        }))
      : [];

    const newProjects = Array.isArray(deptLanes.new?.projects)
      ? deptLanes.new!.projects!.map((p: any) => ({
          title: p?.title ?? '',
          mainLever: p?.mainLever,
          horizon: p?.horizon,
        }))
      : [];

    return {
      existing: existingProjects.length > 0 ? { projects: existingProjects } : undefined,
      new: newProjects.length > 0 ? { projects: newProjects } : undefined,
    };
  };

  let changed = false;
  const nextCache = { ...laneCacheRef.current };

  for (const dept of departments ?? []) {
    if (!dept?.name) continue;
    if (nextCache[dept.name]) continue;

    const fromDept = convertDeptLanes(dept.lanes);
    const hasAny = !!fromDept?.existing?.projects?.length || !!fromDept?.new?.projects?.length;
    if (!hasAny) continue;

    nextCache[dept.name] = fromDept!;
    changed = true;
  }

  if (changed) {
    laneCacheRef.current = nextCache;
    persistLaneCache();
    setLaneRenderVersion((v) => v + 1);
  }
}, [departments, persistLaneCache]);

useEffect(() => {
  try {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem(laneCacheKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      laneCacheRef.current = parsed;
      setLaneRenderVersion((v) => v + 1);
    }
  } catch {
    // ignore
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [laneCacheKey]);

  /* ===== 部門配列更新ヘルパー ===== */
  const pushToStore = useCallback(
    (next: Department[] | ((prev: Department[]) => Department[])) => {
      const prev = ((useStrategyStore.getState().departments as Department[] | undefined) ?? []) as Department[];
      const resolved = typeof next === 'function' ? (next as (p: Department[]) => Department[])(prev) : next;
      if (!jsonEq(prev, resolved)) setDepartmentsInStore?.(resolved);
    },
    [setDepartmentsInStore],
  );

  // ★ Phase 1: Project owner 更新 callback
  const handleProjectOwnerChange = useCallback(
    (deptIndex: number, projIndex: number, ownerName: string) => {
      pushToStore((prev) => {
        const list = [...prev];
        const dept = list[deptIndex];
        if (!dept) return prev;
        const projects = Array.isArray(dept.projects) ? [...dept.projects] : [];
        if (!projects[projIndex]) return prev;
        projects[projIndex] = { ...projects[projIndex], ownerName };
        list[deptIndex] = { ...dept, projects };
        return list;
      });
    },
    [pushToStore],
  );

  const [activeTab, setActiveTab] = useState<'edit' | 'visual'>('edit');
  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});

  /* ===== 部門の増減に応じてインライン編集状態をリセット ===== */
  useEffect(() => {
    setInlineEdit({});
  }, [departments.length]);

  /* ===== その場保存（部門ミッション） ===== */
  const saveInlineMission = async (index: number) => {
    let changed = false;

    pushToStore((prev) => {
      const current = [...prev];
      const d = current[index];
      if (!d) return prev;

      // ★ FIXED: mission フィールド統一（strategy/missionDraft は使わない）
      const draft = (inlineEdit[index] ?? d.mission ?? '').toString();
      if ((d.mission ?? '') === draft) return prev;

      const updated: Department = { ...d, mission: draft };
      current[index] = updated;
      changed = true;
      return current;
    });

    if (!changed) {
      setNotice('（変更はありません）');
      return;
    }

    setNotice('✅ 保存中...');
  };

  const requireStoryOrWarn = (): string | null => {
    if (!storyText.trim()) {
      setNotice('⚠️ 経営ストーリーを先に作成してください（STAGE 2 の完了が必要です）');
      return null;
    }
    return storyText;
  };

  /* ===== 離脱/非表示時の即時保存 ===== */
  useEffect(() => {
    const flush = async () => {
      const st = useStrategyStore.getState();
      if (st.boot?.isHydrating || !st.boot?.isHydrated) return;
      const snap = makeSaveSnapshot(st);
      const hash = hashSnapshot(snap);
      if (st.lastServerSnapshot && st.lastServerSnapshot === hash) return;
      try {
        await saveNow?.();
      } catch {
        // ignore
      }
    };
    const onBeforeUnload = () => void flush();
    const onPageHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveNow]);

  /* ===== プロジェクト削除 ===== */
  const handleDeleteProject = async (deptIndex: number, projectId: string) => {
    // ★ 診断2: 削除ボタンクリック確認
    console.log('DELETE_CLICKED', { deptIndex, projectId, timestamp: new Date().toISOString() });

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト削除の権限がありません');

    // ★ 修正: resolveProjectId で既存データ未付与対応（既存プロジェクトも照合可能）
    const targetProject = (dept.projects as Project[] | undefined)?.find(
      (p) => resolveProjectId(p, dept.name) === projectId
    );

    if (!targetProject) {
      // ★ Silent return 防止：なぜ見つからないのか診断ログ
      const projectIdsInDept = (dept.projects as Project[] | undefined)?.map(
        (p) => resolveProjectId(p, dept.name)
      ) ?? [];
      console.warn('[diag][stage3:delete:not-found]', {
        clickedProjectId: projectId,
        deptName: dept.name,
        projectIdsInDept,
      });
      return setNotice(`⚠️ プロジェクトが見つかりません（ID: ${projectId}）`);
    }

    const ok = window.confirm(`プロジェクト「${targetProject.title || '無題'}」を削除しますか？`);
    if (!ok) return;

    console.log('[diag][stage3:delete:lookup]', {
      deptName: dept.name,
      clickedProjectId: projectId,
      foundProjectTitle: targetProject.title,
      deptProjectCount: (dept.projects as Project[] | undefined)?.length ?? 0,
    });

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;

      // ★ 修正: resolveProjectId で削除（既存データ未付与対応）
      const projects = (d.projects as Project[] | undefined)?.filter(
        (p) => resolveProjectId(p, d.name) !== projectId
      ) ?? [];

      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`🗑 プロジェクト「${targetProject.title || '無題'}」を削除しました`);
  };

  /* ===== プロジェクト追加（手入力／OKR画面で詳細編集も可能） ===== */
  const handleAddProject = async (deptIndex: number) => {
    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const dept = current[deptIndex];
    if (!dept) return;
    if (!canEditDept()) return setNotice('⚠️ プロジェクト追加の権限がありません');

    const existingProjects = (dept.projects as Project[] | undefined) ?? [];
    const baseTitle = '新しいプロジェクト';
    const existing = new Set(existingProjects.map((p) => normalizeTitleKey(p.title || '')));
    let title = baseTitle;
    let n = 2;
    while (existing.has(normalizeTitleKey(title))) {
      title = `${baseTitle} ${n}`;
      n += 1;
    }

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;

      const projects: Project[] = [
        ...((d.projects as Project[] | undefined) ?? []),
        {
          title,
          okrs: [] as StoreOKR[],
          skillRequirements: { roleSkills: [], executionSkills: ['PM', '標準化', 'データ活用'] },
          humanInvestments: [],
          // ★ Phase 1: Project owner 初期値
          ownerUserId: null,
          ownerName: '',
        } as any,
      ];

      list[deptIndex] = { ...d, projects };
      return list;
    });

    setNotice(`✅ プロジェクト「${title}」を追加しました`);
  };

  /* ===== 部門削除 ===== */
  const handleDeleteDepartment = async (index: number) => {
    if (!canEditCompany) {
      setNotice('⚠️ 部門削除は管理者のみ可能です');
      return;
    }

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const target = current[index];
    if (!target) return;

    const ok = window.confirm(`「${target.name}」を削除しますか？\nこの操作は元に戻せません。`);
    if (!ok) return;

    // ★ DIAG: 削除前の状態
    console.log('[diag][stage3:delete:before]', {
      deleteType: 'department',
      index,
      deptName: target.name,
      deptId: target.id,
      deptCountBefore: current.length,
    });

    pushToStore((prev) => {
      const raw = prev.filter((_, i) => i !== index);
      const next: Department[] = raw.map((d, i) => ({
        ...d,
        answers2: (d.answers2 ?? []).map((ch) => ({
          ...ch,
          chapterIndex: i,
          chapterTitle: d.name,
        })),
      }));

      // ★ DIAG: 削除直後の状態
      console.log('[diag][stage3:delete:after]', {
        deleteType: 'department',
        deptName: target.name,
        deptCountAfter: next.length,
        deptId: target.id,
      });

      return next;
    });

    // レーンキャッシュも掃除
    try {
      const copy = { ...laneCacheRef.current };
      delete copy[target.name];
      laneCacheRef.current = copy;
      persistLaneCache();
    } catch {
      // ignore
    }

    setNotice(`🗑 ${target.name} を削除しました`);
  };

  /* =========================
     ApiProjectDraft → Project 型変換（TS2322対応）
  ========================= */
  /**
   * ApiProjectDraft を Project に変換
   * - title は必須文字列に（undefined は補完）
   */
  const toProjectFromDraft = (d: ApiProjectDraft): Project => {
    const title = (d.title ?? '').trim() || '（未設定プロジェクト）';
    return {
      title,
      reason: d.reason,
      hypothesis: d.hypothesis,
      okrs: [],
    } as Project;
  };

  /**
   * ApiDeptDraft.lanes → Department.lanes（Project[]に変換）
   */
  const toLanesProjects = (lanes?: ApiDeptDraft['lanes']): Department['lanes'] | undefined => {
    if (!lanes) return undefined;

    const out: Department['lanes'] = {};

    const ex = lanes.existing?.projects;
    if (Array.isArray(ex) && ex.length > 0) {
      out.existing = { projects: ex.map(toProjectFromDraft) };
    }

    const nw = lanes.new?.projects;
    if (Array.isArray(nw) && nw.length > 0) {
      out.new = { projects: nw.map(toProjectFromDraft) };
    }

    return Object.keys(out).length > 0 ? out : undefined;
  };

  const deptLanesToApiLanes = (deptLanes?: Department['lanes']) => {
    if (!deptLanes) return undefined;

    const existingProjects = Array.isArray(deptLanes.existing?.projects)
      ? deptLanes.existing!.projects!.map((p: any) => ({
          title: p?.title ?? '',
          mainLever: p?.mainLever,
          horizon: p?.horizon,
        }))
      : [];

    const newProjects = Array.isArray(deptLanes.new?.projects)
      ? deptLanes.new!.projects!.map((p: any) => ({
          title: p?.title ?? '',
          mainLever: p?.mainLever,
          horizon: p?.horizon,
        }))
      : [];

    return {
      existing: existingProjects.length > 0 ? { projects: existingProjects } : undefined,
      new: newProjects.length > 0 ? { projects: newProjects } : undefined,
    };
  };

  const getDeptGenerationMeta = (dept: Department, laneCache?: { existing?: ApiLane; new?: ApiLane }) => {
    const existingCount =
      dept.generationMeta?.existingCount ??
      laneCache?.existing?.projects?.length ??
      dept.lanes?.existing?.projects?.length ??
      0;

    const newCount =
      dept.generationMeta?.newCount ??
      laneCache?.new?.projects?.length ??
      dept.lanes?.new?.projects?.length ??
      0;

    return {
      existingCount,
      newCount,
      totalCount: dept.generationMeta?.totalCount ?? existingCount + newCount,
    };
  };

  
  // OKRのkeyResultsが string[] 期待のAPIに対して、Store側が構造化オブジェクトを持っていても送信時に string 化する
  const krToText = (kr: any): string => {
    if (typeof kr === 'string') return kr;
    if (!kr || typeof kr !== 'object') return String(kr ?? '');
    const cand =
      (kr as any).text ??
      (kr as any).title ??
      (kr as any).label ??
      (kr as any).name ??
      (kr as any).kr ??
      (kr as any).description ??
      (kr as any).metric ??
      (kr as any).value;
    if (typeof cand === 'string') return cand;
    try {
      return JSON.stringify(kr);
    } catch {
      return String(cand ?? '');
    }
  };

  const normalizeKeyResults = (krs: any[]): string[] => {
    if (!Array.isArray(krs)) return [];
    return krs.map(krToText).filter((x) => typeof x === 'string' && x.trim().length > 0);
  };

/* =========================
     この部門だけ：/api/generate-cascade を使ったたたき台生成（2レーン対応）
     ※この機能は「削除対象ではない」ため維持
  ========================= */
  const handleDeptCascadeDraft = async (index: number, mode: 'draft' | 'regen' = 'draft') => {
    const story = requireStoryOrWarn();
    if (!story) return;
    if (!canEditDept()) return setNotice('⚠️ 編集権限がありません');

    const s = useStrategyStore.getState() as any;
    const current = (s.departments as Department[] | undefined) ?? [];
    const dept = current[index];
    if (!dept) return;

    // ★TASK A: 生成開始フラグをセット（保存抑止開始）
    setIsGenerating(true);
    setLoading((p) => ({
      ...p,
      [index]: {
        ...(p[index] || {}),
        deptDraft: mode === 'draft',
        deptRegen: mode === 'regen',
      },
    }));

    // ★ TRACE POINT 1: Function entry
    console.log('[diag][stage3:regen:enter]', {
      index,
      deptName: dept.name,
      mode,
      deptIndex: index,
      timestamp: new Date().toISOString(),
    });

    try {
      const payload: any = {
        thought: s?.thought ?? '',
        vision: s?.vision ?? '',
        mission: s?.mission ?? '',
        industry,
        revenue: s?.revenue ?? s?.company?.revenue,
        employees: s?.employees ?? s?.company?.employees,
        value: s?.value ?? '',
        strength: s?.strength ?? '',
        weakness: s?.weakness ?? '',
        opportunity: s?.opportunity ?? '',
        threat: s?.threat ?? '',
        story: rawStory,
        // ★TASK 1: finalStory をpayloadに追加
        finalStory: s?.finalStory ?? undefined,
        strategySummary: s?.strategySummary ?? '',
        departments: [
          {
            name: dept.name,
            missionDraft: dept.mission ?? dept.strategy ?? dept.missionDraft ?? '',
            projects: ((dept.projects as Project[] | undefined) ?? []).map((p) => p.title),
            okrs:
              ((dept.projects as Project[] | undefined) ?? [])
                .flatMap((p) => (p.okrs ?? []) as StoreOKR[])
                .map((o) => ({
                  objective: o.objective ?? '',
                  keyResults: normalizeKeyResults(o.keyResults ?? []),
                  owner: o.owner ?? '',
                  expectedImpactYen: typeof o.expectedImpactYen === 'number' ? o.expectedImpactYen : undefined,
                  probability: typeof o.probability === 'number' ? o.probability : undefined,
                })) ?? [],
            direction: (dept as any).direction,
            expectations: (dept as any).expectations,
            focusThemes: (dept as any).focusThemes,
            answers: dept.answers2?.[0]?.steps ?? [],
          },
        ],
        csvFinanceData: s?.csvFinanceData ?? [],
        financeSummary: s?.financeSummary,
        businessPortfolio: s?.businessPortfolio,
        // ★P3拡張：businessSegments を送信（segmentName マッピング用）
        businessSegments: s?.businessSegments ?? [],
        // ★STAGE2構造化データを追加
        winPatternPrimary,
        winPatternSecondary,
        valueDriverKPIs,
        targetRanges,
      };

      // ★TASK 1: 送信前にfinalStoryが含まれているか確認

      let data: ApiCascadeResponse | null = null;
      try {
        data = await authFetchJson<ApiCascadeResponse>('/api/generate-cascade', {
          method: 'POST',
          json: payload,
        });

        // ★ TRACE POINT 13: API response received
        if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' && data?.departments) {
          const apiDepts = Array.isArray(data.departments) ? data.departments : [];
          const apiProjCount = apiDepts.reduce((s: number, d: any) => {
            return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
          }, 0);
          const apiSummary = apiDepts.map((d: any, di: number) => ({
            index: di,
            name: d?.name,
            projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
            projectTitles: (d?.projects ?? []).map((p: any) => p?.title),
          }));
          console.log('[TRACE_PROJECTS][cascade][api-response]', {
            strategyId: useStrategyStore.getState().strategyId,
            timestamp: new Date().toISOString(),
            totalDepartments: apiDepts.length,
            totalProjects: apiProjCount,
            departments: apiSummary,
          });
        }
      } catch (e) {
        if (e instanceof AuthFetchError) {
          if (e.code === 'AUTH_NO_SESSION') {
            setNotice('❌ セッションが取得できませんでした（再ログインしてください）');
          } else if (e.status === 403) {
            setNotice('❌ 権限がありません（Admin/Managerのみ利用可）');
          } else if (e.status === 401) {
            setNotice('❌ 認証に失敗しました（ログインし直してください）');
          } else {
            setNotice(`❌ 部門のたたき台生成に失敗しました：${e.bodyText || e.message}`);
          }
        } else {
          setNotice(`❌ 部門のたたき台生成に失敗しました：${e instanceof Error ? e.message : String(e)}`);
        }
        return;
      }

      if (!data) {
        setNotice('❌ 応答データが不正です');
        return;
      }

      // ★ TRACE POINT 2: API success
      console.log('[diag][stage3:regen:api-success]', {
        deptName: dept.name,
        deptIndex: index,
        apiDepartmentCount: Array.isArray(data.departments) ? data.departments.length : 0,
        timestamp: new Date().toISOString(),
      });

      // ★部門の一致を確認（他部門データ混入防止）

      const rd: ApiDeptDraft | null | undefined = Array.isArray(data.departments)
        ? data.departments.find(d => d.name === dept.name)
        : null;

      if (!rd) {
        setNotice('⚠️ この部門のたたき台が取得できませんでした');
        console.warn(`[Cascade] 部門名マッチなし：要求="${dept.name}"、応答="${data.departments?.map(d => d.name).join(', ')}"` );
        return;
      }


      // ★ 表示/保存の両方で「部門名：」プレフィックスを除去（冗長な接頭辞を抑制）
      const cleanedRd = stripDeptPrefixDeep(rd, dept.name) as ApiDeptDraft;

      // レーンキャッシュ（OKRは一切変更しない）
      if (cleanedRd?.lanes?.existing || cleanedRd?.lanes?.new) {
        laneCacheRef.current[dept.name] = { existing: cleanedRd.lanes?.existing, new: cleanedRd.lanes?.new };
      } else {
        if (Array.isArray(cleanedRd.projects)) {
          laneCacheRef.current[dept.name] = {
            existing: {
              projects: Array.isArray(cleanedRd.projects) ? cleanedRd.projects : [],
            },
          };
        }
      }

      // ★ lane cache をリロードに耐えるよう sessionStorage へ退避
      persistLaneCache();
      setLaneRenderVersion((v) => v + 1);

      // ★ TRACE POINT 14: before pushToStore
      const beforePushDepts = useStrategyStore.getState().departments as Department[] | undefined;
      const beforePushProjCount = (Array.isArray(beforePushDepts) ? beforePushDepts : []).reduce((s: number, d: any) => {
        return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
      }, 0);
      if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
        console.log('[TRACE_PROJECTS][cascade][before-pushToStore]', {
          strategyId: useStrategyStore.getState().strategyId,
          timestamp: new Date().toISOString(),
          totalDepartments: Array.isArray(beforePushDepts) ? beforePushDepts.length : 0,
          totalProjects: beforePushProjCount,
        });
      }

      pushToStore((prev) => {
        const list = [...prev];
        const d = list[index];
        if (!d) return prev;

        const existingProjects = (d.projects as Project[] | undefined) ?? [];
        const patch: Partial<Department> = {};

        // ★ FIXED: mission / missionDescription 統一（strategy/missionDraft は使わない）
        const missionDraft = (cleanedRd.missionDraft ?? '').trim();
        const missionDescription = (cleanedRd.missionDescription ?? '').trim();

        if (missionDraft && !jsonEq(missionDraft, d.mission)) {
          patch.mission = missionDraft;
        }

        if (missionDescription && !jsonEq(missionDescription, d.missionDescription)) {
          patch.missionDescription = missionDescription;
        }

        // プロジェクト + OKR（旧＋2レーン統合）
        // ★ 修正1c: deptName を渡してproject.id を生成
        const mergedProjects = applyDeptDraftToProjects(existingProjects, cleanedRd, false, d.name);
        if (!jsonEq(mergedProjects, existingProjects)) {
          patch.projects = mergedProjects;

          // ★診断ログ（save時点）
          if (DEBUG_DUP) {
            const titles = mergedProjects.map(p => p?.title ?? '');
          }
        }

        const generationMeta = {
          existingCount:
            cleanedRd?.lanes?.existing?.projects?.length ??
            cleanedRd?.lanes?.existing?.projects?.length ??
            (Array.isArray(cleanedRd.projects) ? cleanedRd.projects.length : 0),
          newCount: cleanedRd?.lanes?.new?.projects?.length ?? 0,
          totalCount: mergedProjects.length,
          updatedAt: new Date().toISOString(),
        };

        if (!jsonEq(generationMeta, d.generationMeta)) {
          patch.generationMeta = generationMeta;
        }

        // ★ lanes（2レーン構造）を保存（型変換付き）
        const newLanes = toLanesProjects(cleanedRd?.lanes);
        if (newLanes && !jsonEq(newLanes, d.lanes)) {
          patch.lanes = newLanes;
        }

        if (cleanedRd.needsCollab) (patch as any).needsCollab = cleanedRd.needsCollab;
        if (cleanedRd.stopList) (patch as any).stopList = cleanedRd.stopList;
        if (cleanedRd.riskNotes) (patch as any).riskNotes = cleanedRd.riskNotes;

        if (Object.keys(patch).length > 0) list[index] = { ...d, ...patch } as Department;

        return list;
      });

      // ★ TRACE POINT 15: after pushToStore
      const afterSetDepts = useStrategyStore.getState().departments as Department[] | undefined;
      const afterPushProjCount = (Array.isArray(afterSetDepts) ? afterSetDepts : []).reduce((s: number, d: any) => {
        return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
      }, 0);
      if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
        console.log('[TRACE_PROJECTS][cascade][after-pushToStore]', {
          strategyId: useStrategyStore.getState().strategyId,
          timestamp: new Date().toISOString(),
          totalDepartments: Array.isArray(afterSetDepts) ? afterSetDepts.length : 0,
          totalProjects: afterPushProjCount,
          dropped: beforePushProjCount - afterPushProjCount,
        });
      }

      setNotice(`✅ ${dept.name} のミッション・プロジェクト・KPI案を更新しました`);

      // ★ TRACE POINT 3: Before cleanup block - show state before/after pushToStore
      const beforeProjCount = (beforePushDepts ?? []).reduce((s: number, d: any) =>
        s + (Array.isArray(d?.projects) ? d.projects.length : 0), 0);
      const afterProjCount = (afterSetDepts ?? []).reduce((s: number, d: any) =>
        s + (Array.isArray(d?.projects) ? d.projects.length : 0), 0);

      console.log('[diag][stage3:regen:before-cleanup]', {
        deptName: dept.name,
        deptIndex: index,
        beforeDepartmentCount: Array.isArray(beforePushDepts) ? beforePushDepts.length : 0,
        afterDepartmentCount: Array.isArray(afterSetDepts) ? afterSetDepts.length : 0,
        beforeProjectCount: beforeProjCount,
        afterProjectCount: afterProjCount,
        projectDelta: afterProjCount - beforeProjCount,
        timestamp: new Date().toISOString(),
      });

      // ★ PHASE 1: 再生成直後に旧 project の downstream data を cleanup
      // （DB cleanup + local state cleanup）
      try {
        const deptBeforeRegen = (beforePushDepts ?? [])[index];
        const deptAfterRegen = afterSetDepts?.find((d) => d.name === dept.name);

        // ★ TRACE POINT 4: Condition check - show before/after regen state
        console.log('[diag][stage3:regen:condition-check]', {
          deptName: dept.name,
          deptIndex: index,
          hasDeptBeforeRegen: !!deptBeforeRegen,
          deptBeforeRegenProjectCount: (deptBeforeRegen?.projects ?? []).length,
          hasDeptAfterRegen: !!deptAfterRegen,
          deptAfterRegenProjectCount: (deptAfterRegen?.projects ?? []).length,
          beforeRegenName: deptBeforeRegen?.name,
          afterRegenName: deptAfterRegen?.name,
          timestamp: new Date().toISOString(),
        });

        if (deptBeforeRegen && deptAfterRegen) {
          // ★ TRACE POINT 5: Entering cleanup block - condition true
          console.log('[diag][stage3:regen:entering-cleanup]', {
            deptName: dept.name,
            deptIndex: index,
            timestamp: new Date().toISOString(),
          });

          // old/new project の title set を作成
          const oldProjects = (deptBeforeRegen.projects ?? []) as Project[];
          const newProjects = (deptAfterRegen.projects ?? []) as Project[];

          // ★ TRACE POINT 6: Show old/new project counts
          console.log('[diag][stage3:regen:project-comparison]', {
            deptName: dept.name,
            deptIndex: index,
            oldProjectCount: oldProjects.length,
            newProjectCount: newProjects.length,
            oldProjectTitles: oldProjects.map((p) => p?.title ?? ''),
            newProjectTitles: newProjects.map((p) => p?.title ?? ''),
            timestamp: new Date().toISOString(),
          });

          // ★ 修正：「削除された project のみ cleanup」 → 「再生成対象部門の old projects 全件 cleanup」
          // 根拠：STAGE3で部門再生成した時点で、その部門の old project に紐づく
          // すべての downstream data（stage4Plans, okrs 等）は自動的に失効するため
          const allOldProjectIds: string[] = oldProjects
            .map((p) => resolveProjectId(p, deptBeforeRegen.name))
            .filter((id) => id);

          // ★ TRACE POINT 7: Show all old project IDs to be cleaned up
          console.log('[diag][stage3:regen:all-old-project-ids]', {
            deptName: dept.name,
            deptIndex: index,
            allOldProjectIds,
            allOldProjectCount: allOldProjectIds.length,
            oldProjectCount: oldProjects.length,
            newProjectCount: newProjects.length,
            timestamp: new Date().toISOString(),
          });

          // cleanup 対象が存在する場合
          if (allOldProjectIds.length > 0) {
            console.log('[diag][cascade:regen:cleanup:request]', {
              dept: dept.name,
              allOldProjectIds,
              allOldProjectCount: allOldProjectIds.length,
              timestamp: new Date().toISOString(),
            });

            // === Step 1: DB cleanup API call ===
            try {
              const cleanupRes = await authFetchJson(
                '/api/cascade/cleanup-deleted-projects',
                {
                  method: 'POST',
                  json: {
                    deletedProjectIds: allOldProjectIds,  // ★ 修正：allOldProjectIds を配列で渡す
                    departmentId: dept.name,
                  },
                }
              );

              if (cleanupRes && (cleanupRes as any).ok) {
                console.log('[diag][cascade:regen:cleanup:result]', {
                  dept: dept.name,
                  allOldProjectIds,
                  cleaned: (cleanupRes as any).cleaned,
                  timestamp: new Date().toISOString(),
                });
              } else {
                console.warn('[cascade:cleanup] API failed or no ok flag:', cleanupRes);
              }
            } catch (apiErr) {
              console.warn('[cascade:cleanup] API call error:', apiErr);
              // non-blocking: 継続 local cleanup
            }

            // === Step 2: Local state cleanup ===
            const stateBeforeLocalCleanup = useStrategyStore.getState();

            // 2a. stage4Plans: departmentId + project IDs で filter
            // ★ 修正：title ベース判定 → ID ベース判定に変更
            // allOldProjectIds に含まれる project を持つ plan は削除対象
            const oldStage4Plans = stateBeforeLocalCleanup.stage4Plans ?? [];
            const newStage4Plans = oldStage4Plans.filter((plan: any) => {
              if (plan.departmentId !== dept.name) return true; // 他部門は保持

              // baseline/current の projects を ID に変換して確認
              const planProjectIds = new Set(
                [
                  ...(plan.baseline?.projects ?? []),
                  ...(plan.current?.projects ?? []),
                ]
                  .map((p: any) => resolveProjectId(p, dept.name))  // ★ ID 化
                  .filter(Boolean)
              );

              // allOldProjectIds に含まれるプロジェクトがあれば削除対象（return false）
              for (const projId of planProjectIds) {
                if (allOldProjectIds.includes(projId)) return false;  // ★ 修正：除外判定
              }

              return true; // 古いプロジェクトがなければ保持
            });

            if (newStage4Plans.length < oldStage4Plans.length) {
              stateBeforeLocalCleanup.setStage4Plans?.(newStage4Plans);
              console.log('[diag][cascade:regen:stage4Plans-filter]', {
                dept: dept.name,
                action: 'stage4Plans-filtered',
                before: oldStage4Plans.length,
                after: newStage4Plans.length,
                removed: oldStage4Plans.length - newStage4Plans.length,
                timestamp: new Date().toISOString(),
              });
            }

            // 2b. executionPlanBaseline.snapshot: projects[] を refresh
            // ★ 修正：title ベース判定 → ID ベース判定に変更
            // allOldProjectIds に含まれる project を削除する
            const oldBaseline = stateBeforeLocalCleanup.executionPlanBaseline;
            if (oldBaseline?.snapshot) {
              const newSnapshot = oldBaseline.snapshot.map((d: any) => {
                if (d.name !== dept.name) return d; // 他部門は保持

                // projects を ID でフィルタ（allOldProjectIds に含まれるものを除外）
                const filteredProjects = (d.projects ?? []).filter((p: any) => {
                  const projId = resolveProjectId(p, dept.name);  // ★ ID 化
                  return projId && !allOldProjectIds.includes(projId);  // ★ 修正：除外判定
                });

                return { ...d, projects: filteredProjects };
              });

              // 対象部門の projects 件数が実際に減ったかチェック
              const oldDeptProjects = oldBaseline.snapshot?.find(
                (d: any) => d.name === dept.name
              )?.projects ?? [];
              const newDeptProjects = newSnapshot?.find(
                (d: any) => d.name === dept.name
              )?.projects ?? [];

              if (newDeptProjects.length < oldDeptProjects.length) {
                stateBeforeLocalCleanup.setExecutionPlanBaseline?.({
                  ...oldBaseline,
                  snapshot: newSnapshot,
                });
                console.log('[diag][cascade:regen:baseline-filter]', {
                  dept: dept.name,
                  action: 'executionPlanBaseline-snapshot-refreshed',
                  before: oldDeptProjects.length,
                  after: newDeptProjects.length,
                  removed: oldDeptProjects.length - newDeptProjects.length,
                  timestamp: new Date().toISOString(),
                });
              }
            }

            // 2c. projectTargetImpacts: projectId filter
            const oldTargetImpacts = stateBeforeLocalCleanup.projectTargetImpacts ?? [];
            const newTargetImpacts = oldTargetImpacts.filter(
              (impact: any) => !allOldProjectIds.includes(impact.projectId)  // ★ 修正：allOldProjectIds
            );

            if (newTargetImpacts.length < oldTargetImpacts.length) {
              stateBeforeLocalCleanup.setProjectTargetImpacts?.(newTargetImpacts);
              console.log('[diag][cascade:regen:cleanup]', {
                dept: dept.name,
                action: 'projectTargetImpacts-filtered',
                before: oldTargetImpacts.length,
                after: newTargetImpacts.length,
                removed: oldTargetImpacts.length - newTargetImpacts.length,
                timestamp: new Date().toISOString(),
              });
            }

            // 2d. projectIssueLinks: projectId filter
            const oldIssueLinks = (stateBeforeLocalCleanup as any).projectIssueLinks ?? [];
            const newIssueLinks = oldIssueLinks.filter(
              (link: any) => !allOldProjectIds.includes(link.projectId)  // ★ 修正：allOldProjectIds
            );

            if (newIssueLinks.length < oldIssueLinks.length) {
              (stateBeforeLocalCleanup as any).setProjectIssueLinks?.(newIssueLinks);
              console.log('[diag][cascade:regen:cleanup]', {
                dept: dept.name,
                action: 'projectIssueLinks-filtered',
                before: oldIssueLinks.length,
                after: newIssueLinks.length,
                removed: oldIssueLinks.length - newIssueLinks.length,
                timestamp: new Date().toISOString(),
              });
            }
          } else {
            // ★ TRACE POINT 8: No old projects
            console.log('[diag][stage3:regen:no-cleanup-needed]', {
              deptName: dept.name,
              deptIndex: index,
              oldProjectCount: (deptBeforeRegen?.projects ?? []).length,
              newProjectCount: (deptAfterRegen?.projects ?? []).length,
              reason: 'allOldProjectIds.length === 0',  // ★ 修正：変数名更新
              timestamp: new Date().toISOString(),
            });
          }
        } else {
          // ★ TRACE POINT 9: Condition failed - show why cleanup didn't run
          console.log('[diag][stage3:regen:cleanup-skipped]', {
            deptName: dept.name,
            deptIndex: index,
            hasDeptBeforeRegen: !!deptBeforeRegen,
            hasDeptAfterRegen: !!deptAfterRegen,
            reason: deptBeforeRegen ? 'missing afterRegen' : 'missing beforeRegen',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (cleanupErr) {
        console.warn('[cascade:cleanup] exception during cleanup:', cleanupErr);
        // non-blocking: cleanup error は show notice しない
      }

      // ★ TRACE POINT 10: Cleanup block complete
      console.log('[diag][stage3:regen:cleanup-complete]', {
        deptName: dept.name,
        deptIndex: index,
        timestamp: new Date().toISOString(),
      });

      // ★ TASK 5: 再生成直後に stage4Plans と executionPlanBaseline を無効化
      const stateBeforeInvalidate = useStrategyStore.getState();
      const stage4PlansCountBefore = stateBeforeInvalidate.stage4Plans?.length ?? 0;
      const hasExecutionPlanBaseline = stateBeforeInvalidate.executionPlanBaseline != null;

      if (stage4PlansCountBefore > 0 || hasExecutionPlanBaseline) {
        console.log('[diag][stage3:regen:invalidate] stage4Plans/executionPlanBaseline をクリア', {
          stage4PlansCountBefore,
          hasExecutionPlanBaseline,
          dept: dept.name,
          deptProjects: afterSetDepts?.find((d) => d.name === dept.name)?.projects?.length ?? 0,
        });
        stateBeforeInvalidate.setStage4Plans?.([]);
        // ★ executionPlanBaseline をリセット（空オブジェクト）
        stateBeforeInvalidate.setExecutionPlanBaseline?.({});
      }

      // ★TASK A: 生成完了後に必ず1回保存（保存抑止解除前）
      if (saveNow) {
        try {
          await saveNow();
          console.log('[diag][stage3:regen:saved]', {
            dept: dept.name,
            stage4PlansAfterSave: useStrategyStore.getState().stage4Plans?.length ?? 0,
          });
          setNotice(`✅ ${dept.name} のたたき台を更新し、サーバーにも保存しました`);
        } catch {
          setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
        }
      }
    } catch (e: any) {
      // ★ TRACE POINT 10b: Function error
      console.log('[diag][stage3:regen:error]', {
        deptName: dept.name,
        deptIndex: index,
        error: e?.message ?? String(e),
        timestamp: new Date().toISOString(),
      });
      setNotice(`❌ 部門のたたき台生成中にエラーが発生しました：${e?.message ?? '不明なエラー'}`);
    } finally {
      // ★ TRACE POINT 11: Function complete - finally block
      console.log('[diag][stage3:regen:finally]', {
        deptName: dept.name,
        deptIndex: index,
        mode,
        timestamp: new Date().toISOString(),
      });

      // ★TASK A: 生成完了（保存抑止解除）
      setIsGenerating(false);
      setLoading((p) => ({
        ...p,
        [index]: {
          ...(p[index] || {}),
          deptDraft: false,
          deptRegen: false,
        },
      }));
    }
  };

  /* ===== ビジュアルビュー ===== */
  const VisualView = useMemo(() => {
    if (!departments.length) return <div className="text-zinc-600">部門がまだ登録されていません。</div>;
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {departments.map((d: Department, i: number) => (
          <VisualCard key={`v-${d.name}-${i}`} d={d} deptIndex={i} onProjectUpdate={handleProjectOwnerChange} />
        ))}
      </div>
    );
  }, [departments, handleProjectOwnerChange]);

  /* map内 hooks 回避のためのメモ */
  const answersMemo: DeptAnswerStep[][] = useMemo(() => departments.map((d: Department) => toDeptAnswers(d.answers2?.[0]?.steps)), [departments]);
  const projectsMemo: string[][] = useMemo(
    () => departments.map((d: Department) => ((d.projects as Project[] | undefined) ?? []).map((p) => stripDeptPrefix(p.title, d.name))),
    [departments],
  );

  /* ===== JSX ===== */
  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 space-y-6">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold mb-2">STAGE 3：部門戦略策定</h1>
          <p className="text-zinc-600 text-sm">
            経営ストーリーを基に、各部門のミッション・プロジェクト案・KPI案を全体最適を図りながら、部門長・マネージャー層で議論し、明確化します。
          </p>
        </div>
        <div className="shrink-0">
          <SaveStatusIndicator />
        </div>
      </header>

      {isHydrating && (
        <div className="mb-8 rounded-xl border p-4 text-sm text-muted-foreground flex items-center justify-between">
          <span>サーバーからデータを読み込んでいます…</span>
          <Button
            variant="secondary"
            className="h-8 rounded-full px-3"
            onClick={() => setHydrated?.(true)}
            title="強制的に読み込み完了にします"
          >
            手動で続行
          </Button>
        </div>
      )}

      {!isHydrating && (
        <StoryWithKPIComparison
          chapters={storyChapters}
          revenue={kpiBridgeData.revenue}
          operatingProfit={kpiBridgeData.operatingProfit}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="inline-flex border rounded-full overflow-hidden">
          {(['edit', 'visual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm ${activeTab === t ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-800'}`}
              disabled={isHydrating}
            >
              {t === 'edit' ? '編集ビュー' : 'ビジュアルビュー'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end flex-wrap">
          <Button
            variant="outline"
            className="rounded-full h-10 px-5 bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm"
            disabled={isHydrating}
            onClick={async () => {
              if (!saveNow) return;
              try {
                setNotice('💾 保存中です…');
                await saveNow();
                setNotice('✅ 全体を保存しました（サーバーにも反映済み）');
              } catch (e: any) {
                setNotice(`❌ 保存に失敗しました：${e?.message ?? '不明なエラー'}`);
              }
            }}
          >
            <Save className="w-4 h-4 mr-1" />
            全体保存
          </Button>

          {canEditCompany && (
            <Button onClick={() => setShowForm((v) => !v)} className="rounded-full h-10 px-5 border border-zinc-300 bg-white hover:bg-zinc-50 shadow-sm" disabled={isHydrating}>
              <PlusCircle className="w-4 h-4 mr-1" />
              {showForm ? '閉じる' : '部門を追加'}
            </Button>
          )}
        </div>
      </div>

      {showForm && canEditCompany && !isHydrating && (
        <div className="p-6 border rounded-3xl bg-white/70 mb-8">
          <div className="grid md:grid-cols-2 gap-4">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="部門名（例：営業部、人事部、生産本部など）"
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <input
              value={deptMission}
              onChange={(e) => setDeptMission(e.target.value)}
              placeholder="（任意）ミッションのメモ"
              className="border rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)} className="rounded-full h-9 px-4">
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                if (!deptName.trim()) return setNotice('⚠️ 部門名を入力してください');
                const baseName = deptName.trim();
                const baseMission = deptMission.trim();

                let nextLength = 0;
                pushToStore((prev) => {
                  const current = [...prev];
                  const newDept: Department = {
                    name: baseName,
                    mission: baseMission,
                    strategy: baseMission,
                    missionDraft: baseMission,
                    discussionNotes: '',
                    projects: [],
                    answers2: [{ chapterIndex: current.length, chapterTitle: baseName, steps: [] }],
                    finalized: false,
                  };
                  current.push(newDept);
                  nextLength = current.length;
                  return current;
                });

                setDeptName('');
                setDeptMission('');
                setShowForm(false);
                setNotice(`✅ ${baseName} を追加しました（部門数: ${nextLength}）`);
              }}
              className="rounded-full h-9 px-4"
            >
              追加
            </Button>
          </div>
        </div>
      )}

      {notice && <div className="mb-6 text-sm p-3 rounded-xl border bg-emerald-50 text-emerald-800">{notice}</div>}

      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section className="space-y-6">
          {/* ★ TRACE POINT 16: render直前 - departments totalProjects */}
          {process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' && (() => {
            const renderDepts = Array.isArray(departments) ? departments : [];
            const renderProjCount = renderDepts.reduce((s: number, d: any) => {
              return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
            }, 0);
            const renderSummary = renderDepts.map((d: any, di: number) => ({
              index: di,
              name: d?.name,
              projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
              projectTitles: (d?.projects ?? []).map((p: any) => p?.title),
            }));
            console.log('[TRACE_PROJECTS][cascade][render-direct-before]', {
              strategyId,
              timestamp: new Date().toISOString(),
              totalDepartments: renderDepts.length,
              totalProjects: renderProjCount,
              departments: renderSummary,
            });
            return null;
          })()}
          {departments.map((dept: Department, index: number) => {
            const editableDept = canEditDept();
            const L = loading[index] ?? {};
            // ★ FIXED: mission フィールド統一（strategy は使わない）
            const inlineDraft = (inlineEdit[index] ?? dept.mission ?? '').toString();

            const answers = answersMemo[index];
            const projTitles = projectsMemo[index];
            const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

            // ★ FIXED: mission フィールド統一
            const deptMissionText = (dept.mission ?? '').trim();

            const lane = laneCacheRef.current[dept.name] ?? deptLanesToApiLanes(dept.lanes);
            const laneOpen = !!showLaneDetail[dept.name];
            const generationMeta = getDeptGenerationMeta(dept, lane);

            const exCount = generationMeta.existingCount;
            const newCount = generationMeta.newCount;
            void laneRenderVersion;

            const answeredCount = (answers ?? []).filter((a) => (a?.answer ?? '').toString().trim().length > 0).length;
            const allQuestionsAnswered = answeredCount >= 6;

            // ★STAGE3軽量化：lanes が存在する場合は lanes から、なければ dept.projects を使用（重複防止）
            // ★ STEP 1修正：source of truth を dept.projects のみに統一（lanes は参考表示に分離）
            const deptProjects = (dept.projects as Project[] | undefined) ?? [];

            // ★ TRACE POINT 17: render loop 内 - 各 department card の deptProjects 件数
            if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
              console.log('[TRACE_PROJECTS][cascade][render-dept-card]', {
                strategyId,
                timestamp: new Date().toISOString(),
                deptIndex: index,
                deptName: dept.name,
                deptProjectCount: deptProjects.length,
                deptProjectTitles: deptProjects.map((p: any) => p?.title),
              });
            }

            return (
              <div key={`e-${dept.name}-${index}`} className="p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm">
                
<div className="mb-4">
  <div className="flex items-start justify-between gap-3">
    {/* left: dept name + actions */}
    <div className="min-w-0">
      <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
        <Building2 className="w-4 h-4" /> {dept.name}
      </h3>

      {/* ✅ 部門名の直下に「AI生成」＋「生成内訳」 */}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => handleDeptCascadeDraft(index, 'draft')}
          disabled={!editableDept || !!L.deptDraft || !!L.deptRegen || isHydrating}
          className="rounded-full h-9 px-4"
          title="この部門のミッション・プロジェクト案・KPI案をAIが提案します（2レーン対応）"
        >
          <Sparkles className="w-4 h-4 mr-1" />
          {L.deptDraft ? 'たたき台を生成中…' : 'AIでこの部門のたたき台（ミッション・プロジェクト・KPI案）'}
        </Button>

        {(exCount > 0 || newCount > 0) && (
          <Button
            variant="outline"
            className="rounded-full h-9 px-4"
            disabled={isHydrating}
            onClick={() => setShowLaneDetail((p) => ({ ...p, [dept.name]: !p[dept.name] }))}
            title="AI生成の内訳（既存進化／新規探索）を表示します"
          >
            {laneOpen ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
            生成内訳（既存{exCount} / 新規{newCount}）
          </Button>
        )}
      </div>
    </div>

    {/* right: status + delete */}
    <div className="flex items-center gap-2 shrink-0">
      {dept.finalized && <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>}
      {canEditCompany && (
        <Button
          variant="outline"
          className="h-8 px-3 rounded-full border-red-500 text-red-600 hover:bg-red-50 flex items-center gap-1"
          disabled={isHydrating}
          onClick={() => handleDeleteDepartment(index)}
          title="この部門を削除"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-xs">削除</span>
        </Button>
      )}
    </div>
  </div>

  {/* ✅ ミッション */}
  <div className="mt-4">
    <div className="text-[11px] font-semibold text-zinc-600 mb-1">ミッション</div>
    <textarea
      value={inlineDraft}
      onChange={(e) => {
        // ★ FIXED: inlineEdit に一時保存（UIの即時反応用）
        setInlineEdit((p) => ({ ...p, [index]: e.target.value }));
        // ★ FIXED: 同時に store に直接書き込み（保存経路統一）
        if (!editableDept || isHydrating) return;
        pushToStore((prev) => {
          const list = [...prev];
          const d = list[index];
          if (d) d.mission = e.target.value;
          return list;
        });
      }}
      className="w-full border rounded-xl p-2 text-sm"
      readOnly={!editableDept || isHydrating}
      placeholder="この部門の役割やミッションのイメージを記入してください（AIたたき台の修正もここで行います）"
    />
  </div>

  {/* ✅ ミッション説明 */}
  <div className="mt-3">
    <div className="text-[11px] font-semibold text-zinc-600 mb-1">ミッション説明</div>

    {/* ★ CRITICAL: deptId ベースで store から最新の department を毎回取得 */}
    {(() => {
      const storeState = useStrategyStore.getState();
      const deptFromStore = storeState.departments?.find(
        (d: Department) => (dept?.id ? d.id === dept.id : d.name === dept?.name)
      );
      const currentMissionDesc = deptFromStore?.missionDescription ?? '';

      return (
        <textarea
          value={currentMissionDesc}
          onChange={(e) => {
            const v = e.target.value;

            if (!editableDept || isHydrating) {
              return;
            }

            // deptId/name ベースで departments[] から該当部門を見つけて更新
            const storeState2 = useStrategyStore.getState();
            const idx = storeState2.departments?.findIndex(
              (d: Department) => (dept?.id ? d.id === dept.id : d.name === dept?.name)
            ) ?? -1;

            if (idx < 0) {
              return;
            }

            const setDepartmentsInStore = useStrategyStore.getState().setDepartments;
            setDepartmentsInStore((storeState2.departments as Department[]).map((d, i) =>
              i === idx ? { ...d, missionDescription: v } : d
            ));
          }}
          className="w-full border rounded-xl p-2 text-sm"
          readOnly={!editableDept || isHydrating}
          placeholder="この部門のミッションを、背景・狙い・顧客価値の観点で補足してください"
        />
      );
    })()}
  </div>
</div>

                {/* 価値指標（STAGE2）の表示 */}
                {valueDriverKPIs.length > 0 && (
                  <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-blue-700 mb-1">価値指標（STAGE2で設定）</div>
                    <div className="flex flex-wrap gap-1">
                      {valueDriverKPIs.map((kpi: any, i: number) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-[10px] text-blue-700"
                        >
                          {toDisplayText(kpi) || `指標${i + 1}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-zinc-500 mb-3">
                  ※「AIでこの部門のたたき台」はミッション、プロジェクト、説明を生成します。生成後は、必要に応じてKPI（指標）を編集してください。
                </p>

                {laneOpen && (exCount > 0 || newCount > 0) && (
                  <div className="mb-4 rounded-2xl border bg-white/60 p-3">
                    <div className="text-[11px] text-zinc-500 mb-2">
                      参考：/api/generate-cascade の「既存進化（Existing）」と「新規探索（New）」の内訳（保存データは統合済み）
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-white/70 p-3">
                        <div className="text-xs font-semibold text-zinc-800 mb-1">既存進化（Existing）</div>
                        {exCount > 0 ? (
                          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-700">
                            {(lane?.existing?.projects ?? []).map((p, i) => {
                              // ★ 参考表示でも [AI#N] を除去
                              const displayTitle = stripDeptPrefix((p?.title ?? '無題').toString().replace(/^\[AI#\d+\]\s*/i, ''), dept.name);
                              return (
                                <li key={`ex-${dept.name}-${i}`}>
                                  {displayTitle}
                                  {p?.mainLever ? (
                                    <span className="ml-2 text-[10px] text-zinc-500">
                                      [{String(p.mainLever)} / {String(p.horizon ?? '-')}]
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="text-xs text-zinc-500">（なし）</div>
                        )}
                      </div>

                      <div className="rounded-xl border bg-white/70 p-3">
                        <div className="text-xs font-semibold text-zinc-800 mb-1">新規探索（New）</div>
                        {newCount > 0 ? (
                          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-700">
                            {(lane?.new?.projects ?? []).map((p, i) => {
                              // ★ 参考表示でも [AI#N] を除去
                              const displayTitle = stripDeptPrefix((p?.title ?? '無題').toString().replace(/^\[AI#\d+\]\s*/i, ''), dept.name);
                              return (
                                <li key={`new-${dept.name}-${i}`}>
                                  {displayTitle}
                                  {p?.mainLever ? (
                                    <span className="ml-2 text-[10px] text-zinc-500">
                                      [{String(p.mainLever)} / {String(p.horizon ?? '-')}]
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="text-xs text-zinc-500">（なし）</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <DepartmentQuestionStepper
                  departmentName={dept.name}
                  mission={dept.strategy ?? dept.mission}
                  projects={projTitles}
                  okrs={[]}
                  initialStep={1}
                  initialAnswers={answers}
                  onChange={({ answers }) => {
                    if (!editableDept || isHydrating) return;
                    const nextSteps = toStoreSteps(answers);
                    if (jsonEq(nextSteps, currentStoreSteps)) return;

                    pushToStore((prev) => {
                      const list = [...prev];
                      const d = list[index];
                      if (!d) return prev;
                      const updated: Department = {
                        ...d,
                        answers2: [{ chapterIndex: index, chapterTitle: d.name, steps: nextSteps }],
                      };
                      list[index] = updated;
                      return list;
                    });
                  }}
                />


{editableDept && allQuestionsAnswered && (
  <div className="mt-3 flex justify-start">
    <Button
      variant="outline"
      onClick={() => handleDeptCascadeDraft(index, 'regen')}
      disabled={!editableDept || !!L.deptDraft || !!L.deptRegen || isHydrating}
      className="rounded-full h-9 px-4"
      title="6つの回答内容を反映して、ミッション・プロジェクト案・KPI案を再生成します"
    >
      <Sparkles className="w-4 h-4 mr-1" />
      {L.deptRegen ? '回答を反映して再生成中…' : '回答を反映して再生成'}
    </Button>
  </div>
)}

                {deptProjects && deptProjects.length > 0 && (
                  <div className="mt-5 border-t pt-4">
                    

                    <div className="flex items-center justify-between mb-2 gap-2">
                      <h4 className="text-sm font-semibold text-zinc-800">プロジェクト案とKPI案</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-500 hidden sm:inline">※ 詳細な編集や構造化は「KPI設定」画面でも行えます。</span>
                        {editableDept && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 rounded-full text-[11px]"
                            disabled={isHydrating}
                            onClick={() => handleAddProject(index)}
                          >
                            <PlusCircle className="w-3 h-3 mr-1" />
                            プロジェクトを追加
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="sm:hidden text-[11px] text-zinc-500 mb-2">※ 詳細な編集や構造化は「KPI設定」画面でも行えます。</p>

                    <ul className="space-y-2">
                      {deptProjects.map((p, pi) => {
                        const primaryOKR = (p.okrs?.[0] as StoreOKR | undefined) ?? undefined;
                        const primaryObjective = primaryOKR?.objective ?? '';
                        const krs = getProjectKpiLabels(p);

                        // UI表示用：[AI#N] prefix を削除して表示（内部的には title に保持）
                        const displayTitle = stripDeptPrefix(((p.title ?? '').replace(/^\[AI#\d+\]\s*/i, '')), dept.name);

                        return (
                          <li key={resolveProjectId(p, dept.name)} className="flex flex-col gap-2 rounded-2xl border px-3 py-2 bg-white/70">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-zinc-500">•</span>
                                  <input
                                    className="flex-1 text-sm font-medium text-zinc-900 bg-transparent border-b border-dashed border-zinc-300 focus:outline-none focus:border-zinc-500"
                                    value={displayTitle}
                                    placeholder="プロジェクト名を入力（例：新規顧客開拓の強化、人事評価制度の見直し など）"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                        // ★ 編集開始時にAI枠をユーザー化
                                        if (isAiGeneratedProject(proj)) {
                                          proj = promoteToUserProject(proj);
                                        }

                                        proj.title = val;
                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {editableDept && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 rounded-full border-red-500 text-red-600 hover:bg-red-50 text-[11px]"
                                    disabled={!editableDept || isHydrating}
                                    onClick={() => handleDeleteProject(index, resolveProjectId(p, dept.name))}
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    削除
                                  </Button>
                                )}
                              </div>
                            </div>

                            {(p.hypothesis || p.mainLever || p.horizon || p.kind) && (
                              <div className="pl-5 mt-1">
                                {p.hypothesis && <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{p.hypothesis}</p>}
                                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                                  {p.kind && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{KIND_LABEL[p.kind]}</span>}
                                  {p.mainLever && (
                                    <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{LEVER_LABEL[p.mainLever]}</span>
                                  )}
                                  {p.horizon && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{HORIZON_LABEL[p.horizon]}</span>}
                                </div>
                              </div>
                            )}

                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">目標（実現したい状態）</div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={toDisplayText(stripDeptPrefix(primaryObjective, dept.name))}
                                placeholder="例）このプロジェクトにより、狙う成果が再現性をもって出る状態を確立する"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                    // ★ 編集開始時にAI枠をユーザー化
                                    if (isAiGeneratedProject(proj)) {
                                      proj = promoteToUserProject(proj);
                                    }

                                    const okrs: StoreOKR[] = [...(((proj.okrs ?? []) as StoreOKR[]) ?? [])];
                                    if (!okrs[0]) okrs[0] = { objective: '', keyResults: [], owner: undefined };

                                    // ★既存メタ（expectedImpactYen/probability）を落とさない
                                    okrs[0] = { ...okrs[0], objective: val };

                                    proj.okrs = okrs;
                                    proj.okrs = sanitizeOkrsForProject(proj, proj.okrs as StoreOKR[]);

                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            {/* ★Phase 1: Project Owner 入力欄 */}
                            <div className="pl-5 mt-2">
                              <div className="text-[11px] text-zinc-500 mb-1">プロジェクト責任者</div>
                              <input
                                className="w-full text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                value={p.ownerName ?? ''}
                                placeholder="責任者名を入力してください"
                                readOnly={!editableDept || isHydrating}
                                onChange={(e) => {
                                  if (!editableDept || isHydrating) return;
                                  const val = e.target.value;
                                  pushToStore((prev) => {
                                    const list = [...prev];
                                    const d = list[index];
                                    if (!d) return prev;
                                    const projects = [...((d.projects as Project[]) ?? [])];
                                    let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                    // ★ 編集開始時にAI枠をユーザー化
                                    if (isAiGeneratedProject(proj)) {
                                      proj = promoteToUserProject(proj);
                                    }

                                    proj.ownerName = val;
                                    projects[pi] = proj;
                                    list[index] = { ...d, projects };
                                    return list;
                                  });
                                }}
                              />
                            </div>

                            <div className="pl-5 mt-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] text-zinc-500">KPI（指標）</div>
                                {editableDept && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 rounded-full text-[11px]"
                                    disabled={isHydrating}
                                    onClick={() => {
                                      if (!editableDept || isHydrating) return;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                        // ★ 編集開始時にAI枠をユーザー化
                                        if (isAiGeneratedProject(proj)) {
                                          proj = promoteToUserProject(proj);
                                        }

                                        // ★ 修正：okrsV2を正本に（keyResults直接編集を廃止）
                                        const okrsV2: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
                                        okrsV2.push(stringToKRStructured(''));
                                        proj = syncProjectKrRepresentations({ ...proj, okrsV2 });

                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  >
                                    <PlusCircle className="w-3 h-3 mr-1" />
                                    指標を追加
                                  </Button>
                                )}
                              </div>

                              {/* ★ Debug: KPI count */}
                              {krs.length === 0 && (
                                <p className="text-[11px] text-zinc-400">まだ指標案がありません。必要に応じて「指標を追加」から入力してください。</p>
                              )}
                              {krs.length > 0 && (
                                <p className="text-[10px] text-zinc-500 mb-1">【DEBUG】krs.length={krs.length}, okrsV2.length={p.okrsV2?.length ?? 0}</p>
                              )}

                              {krs.map((kr, ki) => (
                                <div key={ki} className="flex items-center gap-2">
                                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">指標{ki + 1}</span>
                                  <input
                                    className="flex-1 text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                    value={toDisplayText(stripDeptPrefix(kr, dept.name))}
                                    placeholder="例）成功条件を合意し、実行設計を確定する／主要指標の計測手段を確立する 等"
                                    readOnly={!editableDept || isHydrating}
                                    onChange={(e) => {
                                      if (!editableDept || isHydrating) return;
                                      const val = e.target.value;
                                      pushToStore((prev) => {
                                        const list = [...prev];
                                        const d = list[index];
                                        if (!d) return prev;
                                        const projects = [...((d.projects as Project[]) ?? [])];
                                        let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                        // ★ 編集開始時にAI枠をユーザー化
                                        if (isAiGeneratedProject(proj)) {
                                          proj = promoteToUserProject(proj);
                                        }

                                        // ★ 修正：okrsV2を正本に（keyResults直接編集を廃止）
                                        const okrsV2: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
                                        if (okrsV2[ki]) {
                                          okrsV2[ki] = { ...okrsV2[ki], label: val };
                                        } else {
                                          // KRが未作成の場合は作成
                                          okrsV2[ki] = stringToKRStructured(val);
                                        }
                                        proj = syncProjectKrRepresentations({ ...proj, okrsV2 });

                                        projects[pi] = proj;
                                        list[index] = { ...d, projects };
                                        return list;
                                      });
                                    }}
                                  />
                                  {editableDept && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 rounded-full text-[11px] border-red-400 text-red-600 hover:bg-red-50"
                                      disabled={isHydrating}
                                      onClick={() => {
                                        if (!editableDept || isHydrating) return;
                                        pushToStore((prev) => {
                                          const list = [...prev];
                                          const d = list[index];
                                          if (!d) return prev;
                                          const projects = [...((d.projects as Project[]) ?? [])];
                                          let proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;

                                          // ★ 編集開始時にAI枠をユーザー化
                                          if (isAiGeneratedProject(proj)) {
                                            proj = promoteToUserProject(proj);
                                          }

                                          // ★ 修正：okrsV2を正本に（keyResults直接編集を廃止）
                                          const okrsV2: any[] = Array.isArray(proj.okrsV2) ? [...proj.okrsV2] : [];
                                          okrsV2.splice(ki, 1);
                                          proj = syncProjectKrRepresentations({ ...proj, okrsV2 });

                                          projects[pi] = proj;
                                          list[index] = { ...d, projects };
                                          return list;
                                        });
                                      }}
                                    >
                                      削除
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>


                            {/* ========== 価値指標紐づけセクション（STAGE3拡張） ========== */}
                            {valueDriverKPIs.length > 0 && (
                              <div className="pl-5 mt-3 pt-3 border-t border-zinc-100">
                                <div className="text-[11px] font-semibold text-zinc-700 mb-2">効かせる価値指標（STAGE2との連携）</div>
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {valueDriverKPIs.map((kpi: any) => {
                                    const kpiId = kpi?.id || kpi?.label;
                                    const isLinked = (p.valueDriverLinks ?? []).includes(kpiId);
                                    return (
                                      <button
                                        key={kpiId}
                                        className={[
                                          'px-2 py-1 rounded-full text-[10px] font-medium transition-colors border',
                                          isLinked ? 'bg-blue-500 text-white border-blue-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50',
                                        ].join(' ')}
                                        disabled={!editableDept || isHydrating}
                                        onClick={() => {
                                          if (!editableDept || isHydrating) return;
                                          pushToStore((prev) => {
                                            const list = [...prev];
                                            const d = list[index];
                                            if (!d) return prev;
                                            const projects = [...((d.projects as Project[]) ?? [])];
                                            const proj: Project = { ...(projects[pi] ?? { title: '' }) } as Project;
                                            const links = [...(proj.valueDriverLinks ?? [])];
                                            const idx = links.indexOf(kpiId);
                                            if (idx >= 0) links.splice(idx, 1);
                                            else links.push(kpiId);
                                            proj.valueDriverLinks = links;
                                            projects[pi] = proj;
                                            list[index] = { ...d, projects };
                                            return list;
                                          });
                                        }}
                                        title={isLinked ? `「${toDisplayText(kpi?.label || kpiId)}」との紐づけを解除` : `「${toDisplayText(kpi?.label || kpiId)}」に効かせる`}
                                      >
                                        {isLinked && '✓ '}
                                        {toDisplayText(kpi?.label || kpiId)}
                                      </button>
                                    );
                                  })}
                                </div>
                                {(!p.valueDriverLinks || p.valueDriverLinks.length === 0) && (
                                  <div className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                                    ⚠️ 価値指標が未設定です。このプロジェクトがどの価値指標に効くかを選択してください。
                                  </div>
                                )}
                              </div>
                            )}
                            {/* ========== 価値指標紐づけセクション終了 ========== */}

                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

export default function CascadePage() {
  return (
    <StrategyGuard mode="edit">
      <CascadePageContent />
    </StrategyGuard>
  );
}
