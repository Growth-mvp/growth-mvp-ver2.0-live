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
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useAccess } from '@/utils/access';
import DepartmentQuestionStepper, {
  type DeptAnswerStep,
  type StepNumber,
  type OKR as DeptOKR,
} from '@/components/guide/QuestionStepper.dept';
import { Button } from '@/components/ui/button';
import { AutoResizeTextarea } from '@/components/ui/AutoResizeTextarea';
import { PlusCircle, Save, Sparkles, Building2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toProbability } from '@/types/strategy';
import { CascadeHeader } from '@/components/stage3/CascadeHeader';
import { CascadeControlBar } from '@/components/stage3/CascadeControlBar';
import { DepartmentAddForm } from '@/components/stage3/DepartmentAddForm';
import { NoticeDisplay } from '@/components/stage3/NoticeDisplay';
import { ReflectionCandidatesSection, type ReflectionCandidate } from '@/components/stage3/ReflectionCandidatesSection';

import { useAutoSave } from '@/hooks/useAutoSave';
import { useStage3PdfExport } from '@/hooks/useStage3PdfExport';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { debugLog } from '@/utils/debug';
import { getStage2ValueDriverKPIs, getStage2TargetRanges, getStage2WinPatterns } from '@/utils/stage2Selectors';
import { formatMillion, safeRatio, formatPct, inferScaleToMillion } from '@/utils/unit';
import { authFetchJson, AuthFetchError } from '@/utils/authFetch';
import { okrsV2ToOkrs, okrsToKpis } from '@/utils/supabase/strategy';
import { stripProjectPrefix } from '@/utils/dateFormatter';
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
    intraCollabCount?: number;
    interCollabCount?: number;
    collabCount?: number;
    totalCount?: number;
    updatedAt?: string;
  };
  intraDeptCollab?: string[];
  interDeptCollab?: string[];
  needsCollab?: string[]; // 旧互換
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
  intraDeptCollab?: string[];
  interDeptCollab?: string[];
  needsCollab?: string[];
  stopList?: string[];
  first90Days?: string[];
  riskNotes?: string[];

  // ★STEP5拡張：事業・部門別戦略の観点（API が返した場合のみ存在する optional 項目）
  currentPosition?: string;
  strategicRole?: string;
  keyIssues?: string[];
  alignmentRiskPoints?: string[];
  reviewSummary?: {
    correctedItems?: string[];
    reconsiderationPoints?: string[];
    crossDeptInsights?: Array<{
      severity?: 'critical' | 'warning' | 'review' | 'info';
      category?: 'overlap' | 'contradiction' | 'collaboration';
      relatedDepts?: string[];
      message?: string;
    }>;
  };
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
 * 再生成時専用: project id を毎回新規発行する
 * - STAGE3 再生成後は、同タイトルでも「新しいプロジェクト」として扱う
 * - STAGE5 の progress_logs 継承を防ぐ
 */
function genRegenProjectId(title: string, deptName?: string): string {
  const base = genIdByTitle(title, deptName);
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${base}-r-${nonce}`;
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


type CrossDeptInsight = {
  severity?: 'critical' | 'warning' | 'review' | 'info';
  category?: 'overlap' | 'contradiction' | 'collaboration';
  relatedDepts?: string[];
  message?: string;
};

function getCrossDeptInsightsByCategory(dept: any) {
  const raw = Array.isArray(dept?.reviewSummary?.crossDeptInsights)
    ? (dept.reviewSummary.crossDeptInsights as CrossDeptInsight[])
    : [];

  const normalized = raw
    .map((item) => ({
      severity: item?.severity,
      category: item?.category,
      relatedDepts: Array.isArray(item?.relatedDepts) ? item.relatedDepts.filter(Boolean) : [],
      message: (item?.message ?? '').toString().trim(),
    }))
    .filter((item) => item.message.length > 0);

  const unique = normalized.filter((item, idx, arr) => {
    const key = `${item.category ?? ''}::${item.relatedDepts.join('|')}::${item.message}`;
    return idx === arr.findIndex((x) => `${x.category ?? ''}::${x.relatedDepts.join('|')}::${x.message}` === key);
  });

  return {
    all: unique,
    overlaps: unique.filter((item) => item.category === 'overlap'),
    contradictions: unique.filter((item) => item.category === 'contradiction'),
    collaborations: unique.filter((item) => item.category === 'collaboration'),
  };
}

function renderCrossDeptInsightLabel(item: CrossDeptInsight) {
  const related = Array.isArray(item.relatedDepts) && item.relatedDepts.length > 0
    ? `関連部門: ${item.relatedDepts.join(' / ')}`
    : '';

  switch (item.severity) {
    case 'critical':
      return related ? `重要 / ${related}` : '重要';
    case 'warning':
      return related ? `注意 / ${related}` : '注意';
    case 'review':
      return related ? `要確認 / ${related}` : '要確認';
    default:
      return related ? `候補 / ${related}` : '候補';
  }
}


function splitDeptReconsiderationPoints(points: string[]) {
  const safePoints = Array.isArray(points) ? points.filter((p) => typeof p === 'string' && p.trim().length > 0) : [];

  const portfolio = safePoints.filter((p) => /ポートフォリオ|維持方針|利益優先事業|高収益事業/.test(p));
  const remaining = safePoints.filter((p) => !portfolio.includes(p));

  return {
    portfolio,
    remaining,
  };
}


function getUnifiedCollaborationCandidates(dept: any) {
  const intra = Array.isArray(dept?.intraDeptCollab)
    ? dept.intraDeptCollab.map((x: any) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const inter = Array.isArray(dept?.interDeptCollab)
    ? dept.interDeptCollab.map((x: any) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const legacy = Array.isArray(dept?.needsCollab)
    ? dept.needsCollab.map((x: any) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const cross = getCrossDeptInsightsByCategory(dept).collaborations
    .map((item) => item?.message?.toString().trim())
    .filter((x): x is string => !!x);

  const dedupe = (arr: string[]) => arr.filter((item, idx) => idx === arr.findIndex((x) => x === item));

  return {
    intra,
    inter,
    legacy,
    cross,
    all: dedupe([...intra, ...inter, ...legacy, ...cross]),
  };
}

function inferCollaborationProjectType(project: any): 'intra' | 'inter' | null {
  const sourceType = String(project?.sourceType ?? '');
  const collaborationType = String(project?.collaborationType ?? '');
  const generatedSlot = Number(project?.generatedSlot ?? 0);

  if (sourceType === 'intraCollab' || collaborationType === 'intraDept' || generatedSlot === 4) return 'intra';
  if (sourceType === 'interCollab' || collaborationType === 'interDept' || generatedSlot === 5) return 'inter';

  // 保存・復元時に sourceType / generatedSlot が落ちた旧データ向けの表示フォールバック。
  // STEP4では5件目まで表示されているのにSTEP1の連携KPIだけ空になるケースを救済する。
  const text = `${project?.title ?? ''} ${project?.reason ?? ''} ${project?.hypothesis ?? ''}`;
  if (/事業部間|他事業部|別事業部|関連事業部|共同検証|共同開発|共同企画|共同提案|との共同|×[^：:]{1,30}事業/.test(text)) {
    return 'inter';
  }
  if (/事業部内|営業\s*[×xX]\s*技術|技術\s*[×xX]\s*営業|共同ヒアリング|共同レビュー|連携提案|重点顧客課題の共同提案/.test(text)) {
    return 'intra';
  }

  return null;
}

function isCollaborationProject(project: any) {
  return inferCollaborationProjectType(project) !== null;
}

function getLaneCollaborationProjects(dept: any, type: 'intra' | 'inter') {
  const laneKey = type === 'intra' ? 'intraCollab' : 'interCollab';
  const laneProjects = dept?.lanes?.[laneKey]?.projects;
  return Array.isArray(laneProjects) ? laneProjects : [];
}

function getCollaborationProjectsByType(dept: any, type: 'intra' | 'inter') {
  const projects = Array.isArray(dept?.projects) ? dept.projects : [];

  const byMetaOrText = projects.filter((project: any) => inferCollaborationProjectType(project) === type);
  if (byMetaOrText.length > 0) return byMetaOrText;

  const byLane = getLaneCollaborationProjects(dept, type);
  if (byLane.length > 0) return byLane;

  // 最終フォールバック：現在の生成順は「既存2 + 新規1 + 事業部内連携1 + 事業部間連携1」。
  // sourceType等が保存時に落ちても、STEP4で5件表示されている場合は4件目/5件目からKPIを拾う。
  const fallbackProject = type === 'intra' ? projects[3] : projects[4];
  return fallbackProject ? [fallbackProject] : [];
}

function getCollaborationKpiLabels(dept: any, type: 'intra' | 'inter', index: number, deptName: string) {
  const project = getCollaborationProjectsByType(dept, type)[index];
  if (!project) return [];

  return getProjectKpiLabels(project)
    .map((label) => toCleanDisplayText(label, deptName).trim())
    .filter(Boolean)
    .slice(0, 4);
}

function renderInsightList(items: Array<{ message?: string; severity?: string; relatedDepts?: string[] }>, keyPrefix: string, emptyText: string) {
  if (!items.length) {
    return <p className="text-xs text-zinc-500">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={`${keyPrefix}-${i}`} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700">
          <div className="mb-1 text-[10px] font-medium text-zinc-500">{renderCrossDeptInsightLabel(item as CrossDeptInsight)}</div>
          <div>{item.message}</div>
        </li>
      ))}
    </ul>
  );
}


/* =========================
   再生成時のOKRスナップショット汚染を防ぐ
   - APIが旧 project の okrs.id / dbOkrId を返しても引き継がない
   - STAGE5 は DB-backed OKR のみを保存対象にするため、Stage3再生成直後の snapshot OKR は
     「内容だけ保持し、ID系は全て破棄」する
========================= */
const stripOkrsIdentityForRegen = (okrs: any[]): StoreOKR[] => {
  if (!Array.isArray(okrs)) return [];
  return okrs
    .map((raw: any) => {
      const objective = String(raw?.objective ?? '').trim();
      const owner = typeof raw?.owner === 'string' ? raw.owner.trim() : undefined;
      const keyResults = Array.isArray(raw?.keyResults)
        ? raw.keyResults
            .map((kr: any) => {
              if (typeof kr === 'string') return kr.trim();
              if (kr && typeof kr === 'object') {
                return String(kr.label ?? kr.name ?? kr.title ?? kr.text ?? '').trim();
              }
              return String(kr ?? '').trim();
            })
            .filter(Boolean)
        : [];
      const expectedImpactYen =
        typeof raw?.expectedImpactYen === 'number' && Number.isFinite(raw.expectedImpactYen)
          ? raw.expectedImpactYen
          : undefined;
      const probability =
        typeof raw?.probability === 'number' && Number.isFinite(raw.probability)
          ? raw.probability
          : undefined;
      const title = typeof raw?.title === 'string' ? raw.title.trim() : undefined;

      const cleaned: StoreOKR = {
        objective,
        keyResults,
        owner,
        ...(typeof expectedImpactYen === 'number' ? { expectedImpactYen } : {}),
        ...(typeof probability === 'number' ? { probability } : {}),
        ...(title ? { title } : {}),
      };

      return cleaned;
    })
    .filter((okr) => okr.objective || (okr.keyResults?.length ?? 0) > 0);
};

const stripProjectExecutionBindingsForRegen = (project: Project): Project => {
  const cleaned: any = { ...project };

  cleaned.okrs = stripOkrsIdentityForRegen(Array.isArray(cleaned.okrs) ? cleaned.okrs : []);

  // 旧 downstream 由来の結びつきを持ち越さない
  delete cleaned.dbOkrId;
  delete cleaned.db_okr_id;
  delete cleaned.okrDbId;
  delete cleaned.okr_db_id;
  delete cleaned.displayOkrId;
  delete cleaned.progressOkrId;
  delete cleaned.resolvedDbOkrId;
  delete cleaned.okr_id;
  delete cleaned.okrId;
  delete cleaned.source;

  return cleaned as Project;
};

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


const normalizeProjectTitleForCompare = (text: string, deptName: string) =>
  stripDeptPrefix(String(text ?? '').replace(/^\[AI#\d+\]\s*/i, ''), deptName)
    .replace(/\s+/g, ' ')
    .trim();

function getProjectSourceLabel(project: { title?: string }, deptName: string, lane?: { existing?: ApiLane; new?: ApiLane }): string | null {
  const target = normalizeProjectTitleForCompare(project?.title ?? '', deptName);
  if (!target) return null;

  const matchInLane = (projects?: Array<{ title?: string }>) =>
    Array.isArray(projects) &&
    projects.some((item) => normalizeProjectTitleForCompare(item?.title ?? '', deptName) === target);

  const isExisting = matchInLane(lane?.existing?.projects as Array<{ title?: string }> | undefined);
  const isNew = matchInLane(lane?.new?.projects as Array<{ title?: string }> | undefined);

  if (isNew && !isExisting) return '新規探索';
  if (isExisting) return '既存進化';
  return null;
}

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

const sanitizeDisplayText = (input?: string) =>
  String(input ?? '')
    .replace(/\s*[（(]?\s*(?:fact|seg|fact-seg|fact-cust|fact-prod|fact-mkt|fact-fin)(?:[-_a-z0-9]+)?\s*[）)]*\s*/gi, ' ')
    .replace(/\s*\[[^\]]*DEBUG[^\]]*\]\s*/gi, ' ')
    .replace(/\s*【[^】]*DEBUG[^】]*】\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

const toCleanDisplayText = (value: any, deptName = '') =>
  sanitizeDisplayText(toDisplayText(stripProjectPrefix(stripDeptPrefix(String(value ?? ''), deptName))));

// STEP1表示用：APIの返却ゆれ（hypothesis / reason / description 等）を吸収して、
// プロジェクト仮説が空表示にならないようにする。
const getProjectHypothesisText = (project: any): string => {
  const candidates = [
    project?.hypothesis,
    project?.reason,
    project?.description,
    project?.rationale,
    project?.assumption,
    project?.summary,
  ];

  for (const value of candidates) {
    const text = sanitizeDisplayText(toDisplayText(value));
    if (text) return text;
  }

  return '';
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
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.55)] dark:border-zinc-700 dark:bg-zinc-900">
      {/* タイトル + 単位 */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div>
          <h5 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h5>
          <p className="mt-0.5 text-[11px] text-zinc-500">現状と目標の比較</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">百万円</span>
      </div>

      {/* 棒グラフ（高さ h-48 = 192px で % が成立） */}
      <div className="relative mx-5 mt-5 h-44 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-4">
          {[0, 1, 2, 3].map((line) => (
            <div key={line} className="border-t border-dashed border-zinc-200/80 dark:border-zinc-800" />
          ))}
        </div>
        <div className="relative flex h-full items-end justify-center gap-12 px-8 pb-4 pt-8">
        {/* 現状 */}
        <div className="flex h-full w-20 flex-col items-center gap-2">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="rounded-t-md bg-zinc-600 shadow-[0_8px_18px_-10px_rgba(39,39,42,0.9)] transition-all dark:bg-zinc-400"
              style={{
                width: '34px',
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
        <div className="flex h-full w-20 flex-col items-center gap-2">
          <div className="flex-1 flex items-end justify-center">
            <div
              className="rounded-t-md bg-blue-600 shadow-[0_8px_18px_-10px_rgba(37,99,235,0.9)] transition-all dark:bg-blue-400"
              style={{
                width: '34px',
                height: `${Math.max(targetHeightPct, 2)}%`,
              }}
            />
          </div>
          {target !== null && (
            <div className="text-xs font-semibold text-zinc-700 dark:text-blue-300 text-center whitespace-nowrap">
              {formatMillion(target)}
            </div>
          )}
          <div className="text-xs text-gray-500 dark:text-gray-500">目標</div>
        </div>
        </div>
      </div>

      {/* 下段：差分・達成率 */}
      <div className="mt-5 grid grid-cols-2 border-t border-zinc-100 dark:border-zinc-800">
        <div className="px-5 py-3">
          <div className="text-[10px] font-medium text-zinc-400">目標までの差</div>
          <div className="mt-0.5 text-sm font-bold text-zinc-800 dark:text-zinc-200">{delta !== null ? formatMillion(delta) : '—'}</div>
        </div>
        <div className="border-l border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="text-[10px] font-medium text-zinc-400">達成率</div>
          <div className="mt-0.5 text-sm font-bold text-blue-700 dark:text-blue-300">{achievementRate !== null ? formatPct(achievementRate) : '—'}</div>
        </div>
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

  // Both values are positive in the usual case, so use the clearer baseline chart.
  // The diverging layout below is reserved for data that actually crosses zero.
  if ((current ?? 0) >= 0 && (target ?? 0) >= 0) {
    return <PositiveOnlyBarCard title={title} current={current} target={target} />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.55)] dark:border-zinc-700 dark:bg-zinc-900">
      {/* タイトル */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
        <div>
          <h5 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h5>
          <p className="mt-0.5 text-[11px] text-zinc-500">現状と目標の比較</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">百万円</span>
      </div>

      {/* 0ライン中心の棒グラフ */}
      <div className="relative mx-5 mt-5 h-44 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/40">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between py-4">
          {[0, 1, 2, 3].map((line) => (
            <div key={line} className="border-t border-dashed border-zinc-200/80 dark:border-zinc-800" />
          ))}
        </div>
        <div className="relative flex h-full justify-center gap-12">
        {/* 0ライン */}
        <div
          className="absolute left-4 right-4 z-10 h-px bg-zinc-400 dark:bg-zinc-600"
          style={{ top: '50%' }}
        />

        {/* 現状 */}
        <div className="relative w-20 flex flex-col items-center">
          {/* + 側（上側50%） */}
          {current !== null && current > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="rounded-t-md bg-zinc-600 shadow-[0_8px_18px_-10px_rgba(39,39,42,0.9)] transition-all dark:bg-zinc-400"
                style={{
                  width: '34px',
                  height: `${Math.max(currentHeightPct, 2)}%`,
                }}
              />
              <div className="mt-1 whitespace-nowrap text-center text-xs font-semibold text-zinc-700 dark:text-zinc-300">
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
        <div className="relative w-20 flex flex-col items-center">
          {/* + 側（上側50%） */}
          {target !== null && target > 0 && (
            <div
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center justify-end"
              style={{ height: '50%' }}
            >
              <div
                className="rounded-t-md bg-blue-600 shadow-[0_8px_18px_-10px_rgba(37,99,235,0.9)] transition-all dark:bg-blue-400"
                style={{
                  width: '34px',
                  height: `${Math.max(targetHeightPct, 2)}%`,
                }}
              />
              <div className="mt-1 whitespace-nowrap text-center text-xs font-semibold text-blue-700 dark:text-blue-300">
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
      </div>

      {/* 下段：差分・達成率 */}
      <div className="mt-5 grid grid-cols-2 border-t border-zinc-100 dark:border-zinc-800">
        <div className="px-5 py-3">
          <div className="text-[10px] font-medium text-zinc-400">目標までの差</div>
          <div className="mt-0.5 text-sm font-bold text-zinc-800 dark:text-zinc-200">{delta !== null ? formatMillion(delta) : '—'}</div>
        </div>
        <div className="border-l border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="text-[10px] font-medium text-zinc-400">達成率</div>
          <div className="mt-0.5 text-sm font-bold text-blue-700 dark:text-blue-300">{achievementRate !== null ? formatPct(achievementRate) : '—'}</div>
        </div>
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
  stage3StrategyBridge,
  onGenerateStrategyBridge,
  onShowDepartmentDesign,
  isGenerating,
}: {
  chapters: { title: string; body: string }[];
  revenue: { current: number | null; target: number | null };
  operatingProfit: { current: number | null; target: number | null };
  stage3StrategyBridge?: any;
  onGenerateStrategyBridge?: () => void;
  onShowDepartmentDesign?: () => void;
  isGenerating?: boolean;
}) {
  const [openChapterIndexes, setOpenChapterIndexes] = useState<number[]>([]);

  const toggleChapter = useCallback((index: number) => {
    setOpenChapterIndexes((prev) =>
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
    );
  }, []);

  const router = useRouter();

  return (
    <section className="mb-8">
      {stage3StrategyBridge || chapters.length ? (
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white/90 shadow-sm backdrop-blur-sm mb-8">
          <div className="flex flex-col gap-3 border-b border-zinc-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-xl font-bold tracking-tight text-zinc-950">
              まず、全社戦略の要点を確認する
            </h3>
            <button
              type="button"
              onClick={() => router.push('/stage2')}
              className="inline-flex shrink-0 items-center justify-center self-start rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50 sm:self-auto"
            >
              全社戦略を詳しく確認する
            </button>
          </div>

          <div className="px-6 py-5">
            {stage3StrategyBridge ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 mb-6">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                    <h4 className="text-sm font-bold text-zinc-900">会社として目指す方向</h4>
                    <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                      {(stage3StrategyBridge.keyThemes || []).map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                    <h4 className="text-sm font-bold text-zinc-900">重点的に伸ばす領域</h4>
                    <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                      {(stage3StrategyBridge.departmentIssues || []).map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <h4 className="text-sm font-bold text-zinc-900">見直すべき事業・活動</h4>
                    <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                      {(stage3StrategyBridge.kpiCriteria || []).map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-3">
                    <h4 className="text-sm font-bold text-zinc-900">各部門に求める役割</h4>
                    <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                      {(stage3StrategyBridge.commonBehaviorChanges || []).map((item: string, i: number) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4 mb-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <p className="text-sm leading-6 text-zinc-700">
                      次に、各部門ごとにたたき台を生成し、自部門が全社戦略にどう貢献するかを具体化します。
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={onShowDepartmentDesign}
                        className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-950 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"
                      >
                        部門別設計へ進む
                      </button>
                    </div>
                  </div>
                </div>

                {/* ★ STAGE2で確定された全社戦略サマリーはここに表示されます */}
                {chapters.length > 0 && stage3StrategyBridge?.generatedAt && (
                  <div className="pt-3 border-t border-zinc-200">
                    <p className="text-xs text-zinc-500">
                      STAGE2から引き渡し済み：{new Date(stage3StrategyBridge.generatedAt).toLocaleString('ja-JP')}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-center">
                <p className="text-sm text-amber-800 mb-4">
                  STAGE2で全社戦略を確定すると、ここに部門展開の要点が表示されます。
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/stage2')}
                  className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                >
                  STAGE2で全社戦略を確認する
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

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

function normalizeProjectDraft(pd: ApiProjectDraft, deptName?: string, preserveOkrs: boolean = true): Project | null {
  const title = (pd?.title ?? '').trim();
  if (!title) return null;

  const hypothesis =
    typeof pd?.hypothesis === 'string' && pd.hypothesis.trim()
      ? pd.hypothesis.trim()
      : typeof pd?.reason === 'string' && pd.reason.trim()
        ? pd.reason.trim()
        : typeof pd?.description === 'string' && pd.description.trim()
          ? pd.description.trim()
          : undefined;

  // ★ 修正: 通常生成は安定ID、再生成は新規IDを発行
  // preserveOkrs=false は STAGE3 再生成経路を意味する
  const projectId = preserveOkrs ? genIdByTitle(title, deptName) : genRegenProjectId(title, deptName);

  const p: Project = {
    title,
    hypothesis,
    ...(typeof pd?.reason === 'string' && pd.reason.trim() ? { reason: pd.reason.trim() } : {}),
    ...(typeof pd?.description === 'string' && pd.description.trim() ? { description: pd.description.trim() } : {}),
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
    // ★ 重要：再生成時に旧 OKR の id / dbOkrId を引き継がない
    // STAGE5 の progress_logs は DB-backed OKR にのみ紐づくため、snapshot OKR は内容だけ保持する
    (p as any).okrs = stripOkrsIdentityForRegen(pdOkrs);
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
function applyLaneToProjects(lane?: ApiLane, deptName?: string, preserveOkrs: boolean = true): Project[] {
  const projectsDraft: ApiProjectDraft[] = Array.isArray(lane?.projects) ? lane!.projects! : [];

  // ★重要：ローカル配列のみで構築（既存の base は参照しない）
  const laneProjects: Project[] = [];

  for (let i = 0; i < projectsDraft.length; i++) {
    const pd = projectsDraft[i];
    const normalized = normalizeProjectDraft(pd, deptName, preserveOkrs);
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
    ? applyLaneToProjects({ projects: deptDraft.projects } as ApiLane, deptName, preserveOkrs)
    : [];

  const lane2Projects = applyLaneToProjects(deptDraft?.lanes?.existing, deptName, preserveOkrs);
  const lane3Projects = applyLaneToProjects(deptDraft?.lanes?.new, deptName, preserveOkrs);

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
    // incoming project のみを使用し、同タイトルでも新しい project id を持たせる
    // old project のフィールドを引き継がず、旧 STAGE5 コメント履歴も継承しない
    // さらに、APIレスポンスに旧 OKR ID が混ざっていても STAGE5 に持ち込まないよう
    // snapshot OKR の identity を全て除去する
    return dedupeProjectsByTitle(nextProjects).map((p) => stripProjectExecutionBindingsForRegen(p));
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
                      {getProjectHypothesisText(p) && <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{getProjectHypothesisText(p)}</p>}
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                        {p.kind && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{KIND_LABEL[p.kind]}</span>}
                        {p.mainLever && (
                          <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{LEVER_LABEL[p.mainLever]}</span>
                        )}
                        {p.horizon && <span className="px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-100">{HORIZON_LABEL[p.horizon]}</span>}
                      </div>
                    </div>
                  )}

                  {okr?.objective && <div className="mt-2 text-xs text-zinc-700">目標：{toCleanDisplayText(okr.objective, d.name)}</div>}
                  {krs.length > 0 && (
                    <ul className="mt-1 pl-4 space-y-1 list-disc text-xs text-zinc-700">
                      {krs.slice(0, 3).map((kr, idx) => (
                        <li key={idx}>{toCleanDisplayText(kr, d.name)}</li>
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
  const stage3_strategy_bridge = useStrategyStore((st: any) => st.stage3_strategy_bridge);
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

  const searchParams = useSearchParams();

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

  /* ===== PDF Export ===== */
  const { exportToPdf: stage3ExportToPdf } = useStage3PdfExport();

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
        if (DEBUG) {
          console.log('[cascade] initial hydrate forcing server refresh', {
            accessCompanyId,
            scopeCompanyId,
            hydrated,
            isDirty,
            lastServerSnapshot,
            currentHash,
            timestamp: new Date().toISOString(),
          });
        }

        // 重要:
        // local persist が dirty に見えても、初期ロードでは必ずサーバー正本を取りに行う。
        // これにより、古い local snapshot が server state を上書きして見える事故を防ぐ。
        await loadAndHydrate(accessCompanyId);
        try {
          await refetchFromServer?.();
        } catch (e) {
          console.log('[fetchStrategy:error]', { accessCompanyId, error: String(e), timestamp: new Date().toISOString() });
        }

        setHydrated?.(true);
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
  // ★ FIX: STAGE3 では debounce/minInterval を短縮（保存遅延を減らす）
  useAutoSave({
    enabled: hydrated && !boot?.isHydrating && !isGenerating,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 500,  // ★ STAGE3 最適化：1200ms → 500ms
    minIntervalMs: 800,  // ★ STAGE3 最適化：1500ms → 800ms
    mode: 'payload',
  });

  /* ===== STAGE3専用: 未保存判定 / 保存関数の集約 ===== */
  /* ★ STAGE3 修正: Local baseline ベースの dirty 判定 */
  const cascadeBaselineRef = useRef<string | null>(null);
  const baselineCreatedRef = useRef<boolean>(false);

  const currentSnapshot = useMemo(() => makeSaveSnapshot(useStrategyStore.getState()), [
    strategyId,
    story,
    finalStory,
    departments,
    thought,
    mission,
    vision,
    value,
    csvFinanceData,
    financeSummary,
    businessPortfolio,
  ]);
  const currentSnapshotHash = useMemo(() => hashSnapshot(currentSnapshot), [currentSnapshot]);

  /* ★ STAGE3 修正: hydrate/restore 完了後に baseline を初期化（1回だけ） */
  useEffect(() => {
    if (!hydrated || isHydrating || baselineCreatedRef.current) return;
    if (!currentSnapshotHash) return;

    cascadeBaselineRef.current = currentSnapshotHash;
    baselineCreatedRef.current = true;
  }, [hydrated, isHydrating, currentSnapshotHash]);

  const hasUnsavedChanges = useMemo(() => {
    if (!hydrated || isHydrating) return false;
    if (!cascadeBaselineRef.current) return false;
    return cascadeBaselineRef.current !== currentSnapshotHash;
  }, [hydrated, isHydrating, currentSnapshotHash]);

  const hasUnsavedChangesRef = useRef(false);
  const isGeneratingRef = useRef(false);
  const isPersistingRef = useRef(false);
  const [isGeneratingBridge, setIsGeneratingBridge] = useState(false);
  const [isGoingToStage4, setIsGoingToStage4] = useState(false);
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  const persistCascadeNow = useCallback(
    async (reason: string) => {
      const st = useStrategyStore.getState();
      if (isPersistingRef.current) return true;
      if (st.boot?.isHydrating || !st.boot?.isHydrated) return true;

      const snap = makeSaveSnapshot(st);
      const hash = hashSnapshot(snap);
      const dirty = !!(st.lastServerSnapshot && st.lastServerSnapshot !== hash);
      if (!dirty) return true;

      isPersistingRef.current = true;
      try {
        const shouldToast = reason === 'manual-save' || reason === 'generation-complete';
        if (shouldToast) setNotice('💾 保存中です…');
        await saveNow?.();
        if (shouldToast) setNotice('✅ 保存しました');
        /* ★ STAGE3 修正: save 成功後に baseline を現在値で更新 */
        cascadeBaselineRef.current = hash;
        return true;
      } catch (e: any) {
        console.error('[cascade][persistCascadeNow] failed', { reason, error: e?.message ?? String(e) });
        setNotice(`❌ 保存に失敗しました：${e?.message ?? '不明なエラー'}`);
        return false;
      } finally {
        isPersistingRef.current = false;
      }
    },
    [saveNow],
  );

  // ★ P0-1: STAGE3→STAGE4 transition handler
  const router = useRouter();
  const handleGoToStage4 = useCallback(async () => {
    setIsGoingToStage4(true);
    try {
      setNotice('⏳ STAGE3の保存確認中…');

      // Save STAGE3 data
      const { saveStrategyData } = useStrategyStore.getState();
      await saveStrategyData?.({
        force: true,
        reason: 'stage3:goStage4'
      });

      // Verify STAGE3 data
      const currentState = useStrategyStore.getState() as any;
      const departments = Array.isArray(currentState.departments) ? currentState.departments : [];

      if (departments.length === 0) {
        throw new Error('部門が見つかりません');
      }

      // Check if any department has projects with okrs/kpis/okrsV2
      const hasValidData = departments.some((dept: any) => {
        const projects = Array.isArray(dept.projects) ? dept.projects : [];
        if (projects.length === 0) return false;

        return projects.some((proj: any) => {
          const hasOkrsV2 = Array.isArray(proj.okrsV2) && proj.okrsV2.length > 0;
          const hasOkrs = Array.isArray(proj.okrs) && proj.okrs.length > 0;
          const hasKpis = Array.isArray(proj.kpis) && proj.kpis.length > 0;
          return hasOkrsV2 || hasOkrs || hasKpis;
        });
      });

      if (!hasValidData) {
        throw new Error('部門内にプロジェクト・OKRが見つかりません');
      }

      setNotice('✅ STAGE3の保存を確認しました。STAGE4に進みます…');
      setTimeout(() => {
        router.push('/okr');
      }, 500);
    } catch (err: any) {
      console.error('[cascade:goStage4] verification failed', err, {
        errorMessage: err?.message,
        timestamp: new Date().toISOString()
      });
      setNotice(`⚠️ STAGE3の保存確認に失敗しました：${err?.message || '不明なエラー'}。再度保存してから進んでください。`);
    } finally {
      setIsGoingToStage4(false);
    }
  }, [router]);

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

  // STAGE3 全社戦略サマリー生成
  const handleGenerateStrategyBridge = useCallback(async () => {
    const st = useStrategyStore.getState();
    const finalStoryData = st.finalStoryFinal ?? st.finalStory;

    if (!Array.isArray(finalStoryData) || finalStoryData.length === 0) {
      setNotice('[ERROR] STAGE2最終ストーリーが未設定です');
      return;
    }

    setIsGeneratingBridge(true);
    try {
      const result = await authFetchJson('/api/stage3/generate-strategy-bridge', {
        method: 'POST',
        body: JSON.stringify({
          finalStoryFinal: finalStoryData,
          companyId: accessCompanyId,
        }),
      });

      if ((result as any)?.error) {
        setNotice(`[ERROR] ${(result as any).error}`);
        return;
      }

      useStrategyStore.setState((state: any) => ({
        ...state,
        stage3_strategy_bridge: result,
        dirty: true,
        version: (state.version ?? 0) + 1,
      }));

      const saveState = useStrategyStore.getState();
      await saveState.saveStrategyData({ force: true, reason: 'stage3-bridge-generated' });
      setNotice('[OK] 全社戦略サマリーを生成・保存しました');
    } catch (e: any) {
      console.error('[STAGE3] Error:', e?.message);
      setNotice('[ERROR] 生成に失敗しました');
    } finally {
      setIsGeneratingBridge(false);
    }
  }, [accessCompanyId, setNotice]);

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
  // ★ FIX A: pushToStore で department 単位の差分判定（参照保持）
  const pushToStore = useCallback(
    (next: Department[] | ((prev: Department[]) => Department[])) => {
      const prev = ((useStrategyStore.getState().departments as Department[] | undefined) ?? []) as Department[];
      const resolved = typeof next === 'function' ? (next as (p: Department[]) => Department[])(prev) : next;

      // ★ 最重要: department単位で差分判定
      // 変わってない部門は prev[i] をそのまま返す（参照を保持）
      const optimized = resolved.map((dept, i) => {
        const prevDept = prev[i];
        if (prevDept && jsonEq(prevDept, dept)) {
          // 差分がない → 前の参照をそのまま返す
          console.log('[cascade:pushToStore:dept-compare]', {
            index: i,
            deptName: dept.name,
            same: true,
          });
          return prevDept;
        }
        // 差分がある or 新規 → 新しい参照を使う
        console.log('[cascade:pushToStore:dept-compare]', {
          index: i,
          deptName: dept.name,
          same: false,
        });
        return dept;
      });

      // ★ optimized 配列全体が prev と同じなら setDepartmentsInStore を呼ばない
      if (!jsonEq(prev, optimized)) {
        setDepartmentsInStore?.(optimized);
      }
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
  const projectRowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const autoFocusedCascadeRef = useRef<string>('');
  const [focusedProjectKey, setFocusedProjectKey] = useState<string>('');

  useEffect(() => {
    if (!hydrated || isHydrating) return;
    if (!Array.isArray(departments) || departments.length === 0) return;

    const projectIdParam = String(searchParams?.get('projectId') ?? '').trim();
    const deptIdParam = String(searchParams?.get('deptId') ?? '').trim();
    const projectNameParam = String(searchParams?.get('project') ?? '').trim();
    const deptNameParam = String(searchParams?.get('dept') ?? '').trim();

    if (!projectIdParam && !projectNameParam) return;

    const queryKey = [projectIdParam, deptIdParam, projectNameParam, deptNameParam].join('::');
    if (autoFocusedCascadeRef.current === queryKey) return;

    const norm = (value: unknown) =>
      String(value ?? '')
        .replace(/[\s　]+/g, '')
        .toLowerCase();

    let found: { dept: any; project: any } | null = null;

    for (const dept of departments as any[]) {
      const deptId = String(dept?.id ?? '').trim();
      const deptName = String(dept?.name ?? dept?.departmentName ?? '').trim();

      if (deptIdParam && deptId && deptId !== deptIdParam) continue;
      if (!deptIdParam && deptNameParam && norm(deptName) !== norm(deptNameParam)) continue;

      const deptProjects = Array.isArray(dept?.projects) ? dept.projects : [];
      for (const project of deptProjects) {
        const resolvedId = String(resolveProjectId(project as any, deptName) ?? '').trim();
        const projectId = String((project as any)?.id ?? (project as any)?.projectId ?? resolvedId).trim();
        const projectTitle = String((project as any)?.title ?? '').trim();

        const matchedById = !!projectIdParam && !!projectId && projectId === projectIdParam;
        const matchedByName = !projectIdParam && !!projectNameParam && norm(projectTitle) === norm(projectNameParam);

        if (matchedById || matchedByName) {
          found = { dept, project };
          break;
        }
      }

      if (found) break;
    }

    if (!found) return;

    const deptName = String(found.dept?.name ?? found.dept?.departmentName ?? '');
    const projectKey = `${deptName}::${resolveProjectId(found.project as any, deptName)}`;

    autoFocusedCascadeRef.current = queryKey;
    setActiveTab('edit');
    setFocusedProjectKey(projectKey);

    const clearTimer = window.setTimeout(() => {
      setFocusedProjectKey((prev) => (prev === projectKey ? '' : prev));
    }, 4000);

    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [hydrated, isHydrating, departments, searchParams]);

  useEffect(() => {
    if (activeTab !== 'edit') return;
    if (!focusedProjectKey) return;

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;

      const el = projectRowRefs.current[focusedProjectKey];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      attempts += 1;
      if (attempts < 12) {
        window.setTimeout(tryScroll, 120);
      }
    };

    const rafId = window.requestAnimationFrame(() => {
      window.setTimeout(tryScroll, 80);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [activeTab, focusedProjectKey, departments]);
  const [showForm, setShowForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptMission, setDeptMission] = useState('');
  const [inlineEdit, setInlineEdit] = useState<Record<number, string>>({});
  const [openDepartments, setOpenDepartments] = useState<Record<string, boolean>>({});
  const [activeStepByDept, setActiveStepByDept] = useState<Record<string, 'step1' | 'step2' | 'step3' | 'step4' | 'none'>>({});
  const [removedDepartmentKeys, setRemovedDepartmentKeys] = useState<Record<string, boolean>>({});

  /* ===== 部門追加ハンドラー ===== */
  const handleAddDepartment = async () => {
    if (!deptName.trim()) return setNotice('⚠️ 部門名を入力してください');
    const baseName = deptName.trim();
    const baseMission = deptMission.trim();

    let nextLength = 0;
    pushToStore((prev) => {
      const current = [...prev];
      // ★ prompt.txt指示：部門追加時に初期値を完全に設定
      const deptId = `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newDept: Department = {
        id: deptId,
        name: baseName,
        mission: baseMission || `${baseName}のミッション`,
        missionDescription: '',  // ★ STAGE3生成時にAIで補完対象
        strategy: baseMission,
        missionDraft: baseMission,
        discussionNotes: '',
        projects: [],
        answers2: [
          // ★ 4章構造（第0章〜第3章）で初期化
          { chapterIndex: 0, chapterTitle: `${baseName}：なぜ今`, steps: [] },
          { chapterIndex: 1, chapterTitle: `${baseName}：どう戦う`, steps: [] },
          { chapterIndex: 2, chapterTitle: `${baseName}：どんな未来`, steps: [] },
          { chapterIndex: 3, chapterTitle: `${baseName}：どう実行`, steps: [] },
        ],
        finalized: false,
        source: 'manual',  // ★ STAGE3手動追加を記録
        segmentName: baseName,
      } as unknown as Department;
      current.push(newDept);
      nextLength = current.length;
      return current;
    });

    setDeptName('');
    setDeptMission('');
    setShowForm(false);
    setRemovedDepartmentKeys((prev) => { const next = { ...prev }; delete next[`name:${baseName}`]; return next; });
    setNotice(`✅ ${baseName} を追加しました（部門数: ${nextLength}）`);
  };

  /* ===== 部門の増減に応じてインライン編集状態をリセット ===== */
  const getDepartmentUiKey = useCallback((dept: Department, fallbackIndex?: number) => {
    const base = dept.id ? `id:${dept.id}` : `name:${dept.name}`;
    return fallbackIndex === undefined ? base : `${base}::${fallbackIndex}`;
  }, []);

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

  /* ===== 離脱/非表示/アプリ内遷移の保存ガード ===== */
  useEffect(() => {
    const flush = async () => {
      if (isGeneratingRef.current) return;
      await persistCascadeNow('stage3-visibility-flush');
    };

    // ★ STAGE3は即時保存が機能しているため、離脱警告は不要
    // beforeunload と click イベントリスナーを削除
    // flush は pagehide/visibilitychange で処理
    const onPageHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persistCascadeNow]);

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
  const handleDeleteDepartment = async (index: number, dept?: Department) => {
    if (!canEditCompany) {
      setNotice('⚠️ 部門削除は管理者のみ可能です');
      return;
    }

    const current = (useStrategyStore.getState().departments as Department[] | undefined) ?? [];
    const target = dept ?? current[index];
    if (!target) return;

    const ok = window.confirm(`「${target.name}」を削除しますか？
この操作は元に戻せません。`);
    if (!ok) return;

    console.log('[diag][stage3:delete:before]', {
      deleteType: 'department',
      index,
      deptName: target.name,
      deptId: target.id,
      deptCountBefore: current.length,
    });

    let removed = false;
    const raw = current.filter((item, i) => {
      if (removed) return true;
      const matchedById = !!target.id && item.id === target.id;
      const matchedByIndexAndName = i === index && item.name === target.name;
      if (matchedById || matchedByIndexAndName) {
        removed = true;
        return false;
      }
      return true;
    });
    const next: Department[] = raw.map((d, i) => ({
      ...d,
      answers2: (d.answers2 ?? []).map((ch) => ({
        ...ch,
        chapterIndex: i,
        chapterTitle: d.name,
      })),
    }));

    console.log('[diag][stage3:delete:after]', {
      deleteType: 'department',
      deptName: target.name,
      deptCountAfter: next.length,
      deptId: target.id,
    });

    setDepartmentsInStore?.(next);

    setOpenDepartments((prev) => {
      const next = { ...prev };
      delete next[target.name];
      return next;
    });
    setActiveStepByDept((prev) => {
      const next = { ...prev };
      delete next[target.name];
      return next;
    });
    setRemovedDepartmentKeys((prev) => ({
      ...prev,
      [getDepartmentUiKey(target, index)]: true,
      [getDepartmentUiKey(target)]: true,
    }));

    try {
      const copy = { ...laneCacheRef.current };
      delete copy[target.name];
      laneCacheRef.current = copy;
      persistLaneCache();
    } catch {
      // ignore
    }

    setNotice(`💾 ${target.name} を削除して保存中です…`);
    await Promise.resolve();
    const persisted = await persistCascadeNow('department-delete');
    if (persisted) {
      setNotice(`🗑 ${target.name} を削除して保存しました`);
    } else {
      setNotice(`⚠️ ${target.name} の削除は画面には反映されましたが、保存に失敗しました。全体保存をお試しください。`);
    }
  };

  /* =========================
     ApiProjectDraft → Project 型変換（TS2322対応）
  ========================= */
  /**
   * ApiProjectDraft を Project に変換
   * - title は必須文字列に（undefined は補完）
   * - ★ Approach A: Always assign stable ID via genIdByTitle
   *   Ensures no ID-less projects reach okr/execution stages
   */
  const toProjectFromDraft = (d: ApiProjectDraft): Project => {
    const title = (d.title ?? '').trim() || '（未設定プロジェクト）';

    // ★ Approach A: Respect existing id, generate if missing
    // - deptName not available in this context, use title-only generation
    // - Matches genIdByTitle strategy in normalizeProjectDraft (line 1162)
    const projectId = (d as any).id || genIdByTitle(title, undefined);

    const p: Project = {
      title,
      reason: d.reason,
      hypothesis: d.hypothesis,
      okrs: [],
    } as any as Project & { id?: string };
    (p as any).id = projectId;
    return p;
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

    const intraCollabCount =
      dept.generationMeta?.intraCollabCount ??
      (Array.isArray((dept as any).intraDeptCollab) ? (dept as any).intraDeptCollab.length : 0);

    const interCollabCount =
      dept.generationMeta?.interCollabCount ??
      (Array.isArray((dept as any).interDeptCollab) ? (dept as any).interDeptCollab.length : 0);

    const legacyCollabCount = Array.isArray((dept as any).needsCollab) ? (dept as any).needsCollab.length : 0;
    const collabCount =
      dept.generationMeta?.collabCount ??
      (intraCollabCount + interCollabCount > 0 ? intraCollabCount + interCollabCount : legacyCollabCount);

    return {
      existingCount,
      newCount,
      intraCollabCount,
      interCollabCount,
      collabCount,
      totalCount: dept.generationMeta?.totalCount ?? existingCount + newCount + collabCount,
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
            // ★修正：再生成時は既存 projects の title を seed として送らない（過去の誤生成の汚染防止）
            projects: [],
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
        // ★STEP7: STAGE2中計設計（midtermStrategy）を追加（存在する場合のみ）
        ...(s?.midtermStrategy ? { midtermStrategy: s.midtermStrategy } : {}),
        // ★STAGE2補助セクション編集（stage2FinalDocumentEdits）を追加（存在する場合のみ）
        ...(s?.stage2FinalDocumentEdits ? { stage2FinalDocumentEdits: s.stage2FinalDocumentEdits } : {}),
      };

      // ★TASK 1: 送信前にfinalStoryが含まれているか確認
      console.log('[payload:before-send][stage3:cascade]', {
        businessPortfolio_type: typeof payload.businessPortfolio,
        businessPortfolio_has_units: Array.isArray(payload.businessPortfolio?.units),
        businessPortfolio_units_len: Array.isArray(payload.businessPortfolio?.units) ? payload.businessPortfolio.units.length : 0,
        financeSummary_type: typeof payload.financeSummary,
        financeSummary_keys: payload.financeSummary ? Object.keys(payload.financeSummary).slice(0, 3) : [],
        story_len: typeof payload.story === 'string' ? payload.story.length : 0,
        story_sample: payload.story ? payload.story.slice(0, 100) : 'undefined',
        finalStory_len: typeof payload.finalStory === 'string' ? payload.finalStory.length : 0,
        finalStory_sample: payload.finalStory ? payload.finalStory.slice(0, 100) : 'undefined',
        csvFinanceDataLen: Array.isArray(payload.csvFinanceData) ? payload.csvFinanceData.length : typeof payload.csvFinanceData,
        // ★汚染防止確認：departments[].projects が空であること
        deptProjectsLen: payload.departments?.[0]?.projects?.length ?? 'N/A',
        stage2FinalDocumentEdits: !!payload.stage2FinalDocumentEdits,
      });

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

      // ★ 調査ログ③：フロント受信直後の missionDescription 確認
      {
        if (data?.departments && Array.isArray(data.departments)) {
          console.log('[STAGE3][client received departments]', data.departments.map((d: any) => ({
            name: d?.name,
            missionDraft: d?.missionDraft?.substring(0, 60),
            missionDescription: d?.missionDescription?.substring(0, 60),
          })));
        }
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

      /* ★ 診断：APIレスポンス直後の reviewSummary 確認 */
      console.log('[diag][stage3:reviewSummary:api-response]', {
        dept: rd?.name,
        reviewSummary: (rd as any)?.reviewSummary,
        correctedLen: (rd as any)?.reviewSummary?.correctedItems?.length ?? 0,
        reconsiderationLen: (rd as any)?.reviewSummary?.reconsiderationPoints?.length ?? 0,
      });

      // ★ 表示/保存の両方で「部門名：」プレフィックスを除去（冗長な接頭辞を抑制）
      const cleanedRd = stripDeptPrefixDeep(rd, dept.name) as ApiDeptDraft;

      /* ★ 診断：stripDeptPrefixDeep 後の reviewSummary 確認 */
      console.log('[diag][stage3:reviewSummary:cleanedRd]', {
        dept: cleanedRd?.name,
        reviewSummary: (cleanedRd as any)?.reviewSummary,
        correctedLen: (cleanedRd as any)?.reviewSummary?.correctedItems?.length ?? 0,
        reconsiderationLen: (cleanedRd as any)?.reviewSummary?.reconsiderationPoints?.length ?? 0,
      });

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

      // ★ 調査ログ④：保存直前の cleanedRd missionDescription 確認
      {
        console.log('[STAGE3][before store] cleanedRd missionDescription', {
          deptName: cleanedRd?.name,
          missionDraft: cleanedRd?.missionDraft?.substring(0, 60),
          missionDescription: cleanedRd?.missionDescription?.substring(0, 60),
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

          console.log('[diag][stage3:regen:projects-replaced]', {
            deptName: d.name,
            projectCount: mergedProjects.length,
            projects: mergedProjects.map((p: any) => ({
              title: p?.title,
              projectId: (p as any)?.id,
              okrIds: Array.isArray(p?.okrs) ? p.okrs.map((o: any) => o?.id ?? o?.dbOkrId ?? o?.okrId ?? null) : [],
              objective: p?.okrs?.[0]?.objective ?? null,
            })),
            timestamp: new Date().toISOString(),
          });

          // ★診断ログ（save時点）
          if (DEBUG_DUP) {
            const titles = mergedProjects.map(p => p?.title ?? '');
          }
        }

        const intraDeptCollab = Array.isArray((cleanedRd as any)?.intraDeptCollab)
          ? (cleanedRd as any).intraDeptCollab
          : Array.isArray(cleanedRd?.needsCollab)
            ? cleanedRd.needsCollab
            : [];
        const interDeptCollab = Array.isArray((cleanedRd as any)?.interDeptCollab)
          ? (cleanedRd as any).interDeptCollab
          : [];
        const mergedLegacyNeedsCollab = [...intraDeptCollab, ...interDeptCollab];

        const generationMeta = {
          existingCount:
            cleanedRd?.lanes?.existing?.projects?.length ??
            cleanedRd?.lanes?.existing?.projects?.length ??
            (Array.isArray(cleanedRd.projects) ? cleanedRd.projects.length : 0),
          newCount: cleanedRd?.lanes?.new?.projects?.length ?? 0,
          intraCollabCount: intraDeptCollab.length,
          interCollabCount: interDeptCollab.length,
          collabCount: mergedLegacyNeedsCollab.length,
          totalCount: mergedProjects.length + mergedLegacyNeedsCollab.length,
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

        if (!jsonEq(intraDeptCollab, (d as any).intraDeptCollab ?? [])) (patch as any).intraDeptCollab = intraDeptCollab;
        if (!jsonEq(interDeptCollab, (d as any).interDeptCollab ?? [])) (patch as any).interDeptCollab = interDeptCollab;
        if (!jsonEq(mergedLegacyNeedsCollab, (d as any).needsCollab ?? [])) (patch as any).needsCollab = mergedLegacyNeedsCollab;
        if (cleanedRd.stopList) (patch as any).stopList = cleanedRd.stopList;
        if (cleanedRd.riskNotes) (patch as any).riskNotes = cleanedRd.riskNotes;

        // ★STEP5拡張：事業・部門別戦略の観点（値がある場合のみ store へ反映。
        // 未出力時は既存値を上書きしない）
        if (typeof cleanedRd.currentPosition === 'string' && cleanedRd.currentPosition.trim()) {
          (patch as any).currentPosition = cleanedRd.currentPosition.trim();
        }
        if (typeof cleanedRd.strategicRole === 'string' && cleanedRd.strategicRole.trim()) {
          (patch as any).strategicRole = cleanedRd.strategicRole.trim();
        }
        if (Array.isArray(cleanedRd.keyIssues) && cleanedRd.keyIssues.length > 0) {
          (patch as any).keyIssues = cleanedRd.keyIssues;
        }
        if (Array.isArray(cleanedRd.alignmentRiskPoints) && cleanedRd.alignmentRiskPoints.length > 0) {
          (patch as any).alignmentRiskPoints = cleanedRd.alignmentRiskPoints;
        }

        if (!jsonEq((cleanedRd as any).reviewSummary, (d as any).reviewSummary)) {
          (patch as any).reviewSummary = (cleanedRd as any).reviewSummary;
        }

        /* ★ 診断：patch 作成完了時の reviewSummary 確認 */
        console.log('[diag][stage3:reviewSummary:patch-before-apply]', {
          dept: d.name,
          cleanedReviewSummary: (cleanedRd as any)?.reviewSummary,
          patchReviewSummary: (patch as any)?.reviewSummary,
          patchKeys: Object.keys(patch),
          patchKeysIncludesReviewSummary: Object.keys(patch).includes('reviewSummary'),
        });

        if (Object.keys(patch).length > 0) list[index] = { ...d, ...patch } as Department;

        return list;
      });

      // ★ TRACE POINT 15: after pushToStore
      const afterSetDepts = useStrategyStore.getState().departments as Department[] | undefined;
      const afterPushProjCount = (Array.isArray(afterSetDepts) ? afterSetDepts : []).reduce((s: number, d: any) => {
        return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
      }, 0);

      /* ★ 診断：store 反映後の reviewSummary 確認 */
      const afterStoreReviewSummary = afterSetDepts?.find((x: any) => x.name === dept.name)?.reviewSummary;
      const afterStoreDept = afterSetDepts?.find((x: any) => x.name === dept.name);
      console.log('[diag][stage3:reviewSummary:after-store]', {
        dept: dept.name,
        reviewSummary: afterStoreReviewSummary,
        correctedLen: afterStoreReviewSummary?.correctedItems?.length ?? 0,
        reconsiderationLen: afterStoreReviewSummary?.reconsiderationPoints?.length ?? 0,
      });

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

            // === Step 2: Invalidate STAGE4 artifacts via store action ===
            // ★ STEP 3 修正：filtering + full clear を store action に統一
            // 責務明確化：「無効化」は store action の責務
            // ★ FIX: invalidateStage4ArtifactsAfterCascadeRegeneration は store に未定義のため、ここでは呼ばない
            // if (allOldProjectIds.length > 0) {
            //   useStrategyStore
            //     .getState()
            //     .invalidateStage4ArtifactsAfterCascadeRegeneration?.(
            //       dept.name,
            //       allOldProjectIds
            //     );
            // }
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

      // ★ TRACE POINT 10: Invalidation and cleanup complete
      // (invalidateStage4ArtifactsAfterCascadeRegeneration already called via store action)
      console.log('[diag][stage3:regen:invalidate-complete]', {
        deptName: dept.name,
        deptIndex: index,
        timestamp: new Date().toISOString(),
      });

      // ★TASK A: 生成完了後に必ず1回保存（保存抑止解除前）
      if (saveNow) {
        try {
          const okSaved = await persistCascadeNow('stage3-generate-complete');
          console.log('[diag][stage3:regen:saved]', {
            dept: dept.name,
            stage4PlansAfterSave: useStrategyStore.getState().stage4Plans?.length ?? 0,
          });
          if (okSaved) {
            setNotice(`✅ ${dept.name} のたたき台を更新し、サーバーにも保存しました`);
          } else {
            setNotice('⚠️ 画面上の更新は完了しましたが、サーバー保存に失敗しました');
          }
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

  // ★ FIX B: トップレベルの useCallback で DepartmentQuestionStepper の onChange を作成
  // map 内で毎回新しい関数を作らない（参照を安定化）
  const handleDeptQuestionChange = useCallback((deptIndex: number, answers: DeptAnswerStep[]) => {
    if (!canEditDept() || isHydrating) return;

    const dept = departments[deptIndex];
    if (!dept) return;

    const nextSteps = toStoreSteps(answers);
    const currentStoreSteps = dept.answers2?.[0]?.steps ?? [];

    console.log('[STAGE3-deptQuestion:onChange]', {
      changed: !jsonEq(nextSteps, currentStoreSteps),
      deptIndex,
      deptName: dept.name,
      nextStepsLen: nextSteps.length,
    });

    if (jsonEq(nextSteps, currentStoreSteps)) {
      console.log('[STAGE3-deptQuestion:onChange-skip-same-steps]', {
        deptIndex,
        deptName: dept.name,
      });
      return;
    }

    pushToStore((prev) => {
      const list = [...prev];
      const d = list[deptIndex];
      if (!d) return prev;

      const updated: Department = {
        ...d,
        answers2: [{ chapterIndex: deptIndex, chapterTitle: d.name, steps: nextSteps }],
      };
      list[deptIndex] = updated;
      return list;
    });
  }, [departments, isHydrating, canEditDept, pushToStore]);

  /* ===== 反映候補セクションのハンドラー ===== */
  const handleDeleteReflectionCandidate = (candidateId: string) => {
    setNotice('✅ 反映候補を削除しました');
  };

  /* ===== JSX ===== */
  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 space-y-6">
      <ReflectionCandidatesSection
        onDelete={handleDeleteReflectionCandidate}
      />

      <CascadeHeader exportToPdf={stage3ExportToPdf} />

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
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-900"></h2>
          </div>
          <StoryWithKPIComparison
            chapters={storyChapters}
            revenue={kpiBridgeData.revenue}
            operatingProfit={kpiBridgeData.operatingProfit}
            stage3StrategyBridge={stage3_strategy_bridge}
            onGenerateStrategyBridge={handleGenerateStrategyBridge}
            onShowDepartmentDesign={() => {
              setActiveTab('edit');
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  document.getElementById('stage3-department-design')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                });
              });
            }}
            isGenerating={isGeneratingBridge}
          />
        </section>
      )}

      <CascadeControlBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isHydrating={isHydrating}
        saveNow={saveNow}
        persistCascadeNow={persistCascadeNow}
        setNotice={setNotice}
        canEditCompany={canEditCompany}
        showForm={showForm}
        setShowForm={setShowForm}
        onGoToStage4={handleGoToStage4}
        isGoingToStage4={isGoingToStage4}
      />

      <DepartmentAddForm
        showForm={showForm}
        canEditCompany={canEditCompany}
        isHydrating={isHydrating}
        deptName={deptName}
        setDeptName={setDeptName}
        deptMission={deptMission}
        setDeptMission={setDeptMission}
        setShowForm={setShowForm}
        onAddDepartment={handleAddDepartment}
      />

      <NoticeDisplay notice={notice} />
      {activeTab === 'visual' ? (
        <section>{VisualView}</section>
      ) : (
        <section id="stage3-department-design" className="scroll-mt-6 space-y-6">
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
            debugLog('[TRACE_PROJECTS][cascade][render-direct-before]', {
              strategyId,
              timestamp: new Date().toISOString(),
              totalDepartments: renderDepts.length,
              totalProjects: renderProjCount,
              departments: renderSummary,
            });
            return null;
          })()}

          {/* ★ 診断：render時点での全部門 reviewSummary 集計 */}
          {(() => {
            const summary = (departments ?? []).map((d: any) => ({
              dept: d?.name,
              correctedLen: d?.reviewSummary?.correctedItems?.length ?? 0,
              reconsiderationLen: d?.reviewSummary?.reconsiderationPoints?.length ?? 0,
              willDisplay:
                (d?.reviewSummary?.correctedItems?.length ?? 0) > 0 ||
                (d?.reviewSummary?.reconsiderationPoints?.length ?? 0) > 0,
            }));
            console.log('[diag][stage3:reviewSummary:render-summary-table]', summary);
            return null;
          })()}

          {/* ★ 調査ログ⑤：render時点での全部門 missionDescription */}
          {(() => {
            const missionDescSummary = (departments ?? []).map((d: any) => ({
              dept: d?.name,
              missionDraft: d?.mission?.substring(0, 60),
              missionDescription: d?.missionDescription?.substring(0, 60),
            }));
            console.log('[STAGE3][render-time] all departments missionDescription', missionDescSummary);
            return null;
          })()}

          {departments.map((dept: Department, index: number) => {
            const deptUiKey = getDepartmentUiKey(dept, index);
            if (removedDepartmentKeys[deptUiKey] || removedDepartmentKeys[getDepartmentUiKey(dept)]) return null;
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
            const intraCollabCount = generationMeta.intraCollabCount ?? ((dept as any).intraDeptCollab?.length ?? 0);
            const interCollabCount = generationMeta.interCollabCount ?? ((dept as any).interDeptCollab?.length ?? 0);
            void laneRenderVersion;

            const answeredCount = (answers ?? []).filter((a) => (a?.answer ?? '').toString().trim().length > 0).length;
            const allQuestionsAnswered = answeredCount >= 6;

            // ★STAGE3軽量化：lanes が存在する場合は lanes から、なければ dept.projects を使用（重複防止）
            // ★ STEP 1修正：source of truth を dept.projects のみに統一（lanes は参考表示に分離）
            const deptProjects = (dept.projects as Project[] | undefined) ?? [];
            const correctedCount = dept.reviewSummary?.correctedItems?.length ?? 0;
            const reconsiderationCount = dept.reviewSummary?.reconsiderationPoints?.length ?? 0;
            const crossDeptInsightCount = getCrossDeptInsightsByCategory(dept).all.length;
            const reviewCount = correctedCount + reconsiderationCount + crossDeptInsightCount;
            const isDeptOpen = !!openDepartments[dept.name];
            const inferredMainStep: 'step1' | 'step2' | 'step3' | 'step4' =
              !deptMissionText && deptProjects.length === 0
                ? 'step1'
                : !allQuestionsAnswered
                  ? 'step2'
                  : reviewCount > 0 || !!deptMissionText
                    ? 'step3'
                    : 'step4';
            const activeStep: 'step1' | 'step2' | 'step3' | 'step4' | 'none' = activeStepByDept[dept.name] ?? inferredMainStep;
            const step1Summary = deptMissionText ? 'たたき台あり' : '未生成';
            const step2Summary = `6テーマ ${answeredCount}/6`;
            const step3Summary = reviewCount > 0
              ? `要確認 ${reviewCount}件`
              : (deptMissionText ? '方向性を確認' : '再生成後に確認');
            const step4Summary = `プロジェクト ${deptProjects.length}件`;

            // ★ TRACE POINT 17: render loop 内 - 各 department card の deptProjects 件数
            if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
              debugLog('[TRACE_PROJECTS][cascade][render-dept-card]', {
                strategyId,
                timestamp: new Date().toISOString(),
                deptIndex: index,
                deptName: dept.name,
                deptProjectCount: deptProjects.length,
                deptProjectTitles: deptProjects.map((p: any) => p?.title),
              });
            }

            return (
              <div
                key={`e-${dept.name}-${index}`}
                className={[
                  'p-6 border rounded-3xl bg-white/70 backdrop-blur-sm shadow-sm transition-opacity',
                  !editableDept || isHydrating ? 'pointer-events-none opacity-80' : '',
                ].join(' ')}
              >
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-left"
                  onClick={() => {
                    setOpenDepartments((prev) => {
                      const next = !prev[dept.name];
                      if (next) {
                        setActiveStepByDept((current) => ({ ...current, [dept.name]: current[dept.name] ?? inferredMainStep }));
                      }
                      return { ...prev, [dept.name]: next };
                    });
                  }}
                >
                  <div className="flex items-center gap-2 text-zinc-900 font-semibold">
                    {isDeptOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <span>{dept.name}</span>
                  </div>
                </button>

                {isDeptOpen && (
                <div className="mt-4">
<div className="mb-4">
  <div className="flex items-start justify-end gap-3">
    <div className="flex items-center gap-2 shrink-0">
      {dept.finalized && <span className="text-xs bg-zinc-900 text-white rounded-full px-2 py-1">確定済み</span>}
      {canEditCompany && (
        <Button
          variant="outline"
          className="h-8 px-3 rounded-full border-zinc-300 text-zinc-700 hover:bg-zinc-50 flex items-center gap-1"
          disabled={isHydrating}
          onClick={() => handleDeleteDepartment(index, dept)}
          title="この部門を削除"
        >
          <Trash2 className="w-4 h-4" />
          <span className="text-xs">削除</span>
        </Button>
      )}
    </div>
  </div>

  {/* ★事業・部門別戦略の要点：部門カード展開時に常時表示（埋もれ防止）。
      4項目すべて空の場合はプレースホルダーで機能の存在を示す */}
  {(() => {
    const currentPosition = ((dept as any).currentPosition ?? '').toString().trim();
    const strategicRole = ((dept as any).strategicRole ?? '').toString().trim();
    const keyIssues: string[] = Array.isArray((dept as any).keyIssues) ? (dept as any).keyIssues.filter(Boolean) : [];
    const alignmentRiskPoints: string[] = Array.isArray((dept as any).alignmentRiskPoints) ? (dept as any).alignmentRiskPoints.filter(Boolean) : [];
    const hasAny = !!currentPosition || !!strategicRole || keyIssues.length > 0 || alignmentRiskPoints.length > 0;
    return (
      <div className="mt-3 mb-2 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-3">
        <div className="text-sm font-bold tracking-tight text-indigo-900">事業・部門別戦略の要点</div>
        {hasAny ? (
          <div className="mt-2 space-y-2">
            {currentPosition && (
              <p className="text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                <span className="font-semibold text-zinc-900">現在の位置づけ：</span>{sanitizeDisplayText(currentPosition)}
              </p>
            )}
            {strategicRole && (
              <p className="text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                <span className="font-semibold text-zinc-900">中計上の役割：</span>{sanitizeDisplayText(strategicRole)}
              </p>
            )}
            {keyIssues.length > 0 && (
              <div className="text-sm leading-6 text-zinc-700">
                <span className="font-semibold text-zinc-900">主要課題：</span>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  {keyIssues.slice(0, 4).map((issue, i) => (
                    <li key={`key-issue-${dept.name}-${i}`}>{sanitizeDisplayText(String(issue))}</li>
                  ))}
                </ul>
              </div>
            )}
            {alignmentRiskPoints.length > 0 && (
              <div className="text-sm leading-6 text-zinc-700">
                <span className="font-semibold text-zinc-900">認識のズレが起きやすいポイント：</span>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  {alignmentRiskPoints.slice(0, 3).map((point, i) => (
                    <li key={`alignment-risk-${dept.name}-${i}`}>{sanitizeDisplayText(String(point))}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            中計上の役割や認識のズレは、STAGE1の事業・部門情報とSTAGE2の全社戦略をもとに生成されます。STEP1の「たたき台を生成」を実行すると表示されます。
          </p>
        )}
      </div>
    );
  })()}

  <div className={`mt-3 mb-2 w-full rounded-2xl border px-4 py-3 shadow-sm ${activeStep === 'step1' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-zinc-100 text-zinc-900'}`}>
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => setActiveStepByDept((prev) => ({ ...prev, [dept.name]: activeStep === 'step1' ? 'none' : 'step1' }))}
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className={`text-[11px] font-semibold ${activeStep === 'step1' ? 'text-white' : 'text-zinc-900'}`}>STEP1 たたき台</div>
            <div className={`text-[11px] mt-0.5 ${activeStep === 'step1' ? 'text-zinc-200' : 'text-zinc-700'}`}>生成結果をここでまとめて確認します。</div>
          </div>
          {activeStep === 'step1' ? <ChevronUp className="w-4 h-4 text-white shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-800 shrink-0" />}
        </div>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${activeStep === 'step1' ? 'border border-white/25 bg-white/10 text-white' : 'border border-zinc-400 bg-white text-zinc-700'}`}>{step1Summary}</span>
        <Button
          variant="outline"
          onClick={() => handleDeptCascadeDraft(index, 'draft')}
          disabled={!editableDept || !!L.deptDraft || !!L.deptRegen || isHydrating}
          className={`rounded-full h-8 px-3 ${activeStep === 'step1' ? 'border-white/30 bg-white text-zinc-900 hover:bg-zinc-100' : 'border-zinc-400 bg-white text-zinc-800 hover:bg-zinc-50'}` }
          title="この部門のたたき台を生成します"
        >
          <Sparkles className="w-4 h-4 mr-1" />
          {L.deptDraft ? '生成中…' : 'たたき台を生成'}
        </Button>
      </div>
    </div>
  </div>



{/* ================================================ */}
{/* STEP1 たたき台 */}
{/* ================================================ */}

                {activeStep === 'step1' && (
                <>
                {/* 価値指標（STAGE2）の表示 */}
                {valueDriverKPIs.length > 0 && (
                  <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-zinc-700 mb-1">価値指標（STAGE2で設定）</div>
                    <div className="flex flex-wrap gap-1">
                      {valueDriverKPIs.map((kpi: any, i: number) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200 text-[10px] text-zinc-700"
                        >
                          {toDisplayText(kpi) || `指標${i + 1}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-zinc-500 mb-3">
                  主要な案をまとめて確認できます。
                </p>

                {(deptMissionText || deptProjects.length > 0 || getUnifiedCollaborationCandidates(dept).all.length > 0) && (
                  <div className="mb-5 rounded-3xl border border-zinc-300 bg-white px-5 py-4 shadow-sm">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold tracking-tight text-zinc-900">AIたたき台サマリー</div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">生成されたミッション、プロジェクト案、連携候補をまとめて確認できます。</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-500">生成結果の概要</span>
                    </div>

                    {deptMissionText && (
                      <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="mb-2 text-xs font-bold tracking-tight text-zinc-700">ミッション案</div>
                        <p className="text-base font-semibold leading-7 text-zinc-900 whitespace-pre-wrap">{deptMissionText}</p>
                      </div>
                    )}

                    {((dept as any).missionDescription ?? '').toString().trim() && (
                      <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div className="mb-2 text-xs font-bold tracking-tight text-zinc-700">概要・仮説</div>
                        <p className="text-sm leading-6 text-zinc-700 whitespace-pre-wrap">{sanitizeDisplayText(((dept as any).missionDescription ?? '').toString().trim())}</p>
                      </div>
                    )}


                    {(deptProjects.length > 0 || getUnifiedCollaborationCandidates(dept).all.length > 0) && (
                      <div className="mb-1">
                        <div className="mb-3 text-xs font-bold tracking-tight text-zinc-700">プロジェクト案・KPI案</div>
                        <div className="space-y-3">
                          {deptProjects.filter((p) => !isCollaborationProject(p)).slice(0, 3).map((p, i) => {
                            const displayTitle = stripDeptPrefix(((p.title ?? '').replace(/^\[AI#\d+\]\s*/i, '')), dept.name);
                            const projectSourceLabel = getProjectSourceLabel(p, dept.name, lane);
                            const projectKpis = getProjectKpiLabels(p)
                              .map((label) => toCleanDisplayText(label, dept.name).trim())
                              .filter(Boolean)
                              .slice(0, 4);
                            return (
                              <div key={`step1-preview-${dept.name}-${resolveProjectId(p, dept.name)}-${i}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-base font-semibold leading-6 text-zinc-900">{displayTitle || `プロジェクト${i + 1}`}</div>
                                  {projectSourceLabel && <span className="text-sm font-semibold text-zinc-500">（{projectSourceLabel}）</span>}
                                </div>
                                {getProjectHypothesisText(p) && (
                                  <p className="mt-2 text-sm leading-6 text-zinc-700 whitespace-pre-wrap">
                                    <span className="font-semibold text-zinc-800">仮説：</span>{getProjectHypothesisText(p)}
                                  </p>
                                )}
                                {projectKpis.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {projectKpis.map((label, ki) => (
                                      <span key={`step1-kpi-${dept.name}-${resolveProjectId(p, dept.name)}-${ki}`} className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {getUnifiedCollaborationCandidates(dept).intra.map((item: string, i: number) => {
                            const collabKpis = getCollaborationKpiLabels(dept, 'intra', i, dept.name);
                            return (
                              <div key={`summary-intra-card-${dept.name}-${i}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                <div className="text-base font-semibold leading-6 text-zinc-900">事業部内連携案</div>
                                <p className="mt-2 text-sm leading-6 text-zinc-700 whitespace-pre-wrap"><span className="font-semibold text-zinc-800">連携内容：</span>{item}</p>
                                {collabKpis.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {collabKpis.map((label, ki) => (
                                      <span key={`step1-intra-kpi-${dept.name}-${i}-${ki}`} className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {getUnifiedCollaborationCandidates(dept).inter.map((item: string, i: number) => {
                            const collabKpis = getCollaborationKpiLabels(dept, 'inter', i, dept.name);
                            return (
                              <div key={`summary-inter-card-${dept.name}-${i}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                <div className="text-base font-semibold leading-6 text-zinc-900">事業部間連携案</div>
                                <p className="mt-2 text-sm leading-6 text-zinc-700 whitespace-pre-wrap"><span className="font-semibold text-zinc-800">連携内容：</span>{item}</p>
                                {collabKpis.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {collabKpis.map((label, ki) => (
                                      <span key={`step1-inter-kpi-${dept.name}-${i}-${ki}`} className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700">
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {deptProjects.filter((p) => !isCollaborationProject(p)).length > 3 && (
                          <div className="mt-2 text-xs text-zinc-500">ほか {deptProjects.filter((p) => !isCollaborationProject(p)).length - 3} 件</div>
                        )}
                      </div>
                    )}


                  </div>
                )}

                </>
                )}

                {/* ★ 診断：render時点での reviewSummary 確認 */}
                {(() => {
                  console.log('[diag][stage3:reviewSummary:render]', {
                    dept: dept.name,
                    reviewSummary: dept.reviewSummary,
                    correctedLen: dept.reviewSummary?.correctedItems?.length ?? 0,
                    reconsiderationLen: dept.reviewSummary?.reconsiderationPoints?.length ?? 0,
                    willDisplay: (dept.reviewSummary?.correctedItems?.length ?? 0) > 0 || (dept.reviewSummary?.reconsiderationPoints?.length ?? 0) > 0,
                  });
                  return null;
                })()}

                {/* ================================================ */}
                {/* STEP2 戦略議論 */}
                {/* ================================================ */}
                <button
                  type="button"
                  className={`mt-5 mb-3 w-full rounded-2xl border px-3 py-3 shadow-sm text-left transition-colors ${activeStep === 'step2' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-zinc-100 text-zinc-900'}`}
                  onClick={() => setActiveStepByDept((prev) => ({ ...prev, [dept.name]: activeStep === 'step2' ? 'none' : 'step2' }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className={`text-[11px] font-semibold ${activeStep === 'step2' ? 'text-white' : 'text-zinc-900'}`}>STEP2 戦略議論</div>
                      <div className={`text-[11px] mt-0.5 ${activeStep === 'step2' ? 'text-zinc-200' : 'text-zinc-700'}`}>6つのテーマで議論し、回答がそろったら再生成します。</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700">{step2Summary}</span>
                      {activeStep === 'step2' ? <ChevronUp className="w-4 h-4 text-zinc-800" /> : <ChevronDown className="w-4 h-4 text-zinc-800" />}
                    </div>
                  </div>
                </button>

                {activeStep === 'step2' && (
                <div className="mt-3">
                <DepartmentQuestionStepper
                  departmentName={dept.name}
                  mission={dept.strategy ?? dept.mission}
                  projects={projTitles}
                  okrs={[]}
                  initialStep={1}
                  initialAnswers={answers}
                  onChange={({ answers: changedAnswers }) => {
                    handleDeptQuestionChange(index, changedAnswers);
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
                </div>
                )}

                {/* ================================================ */}
                {/* STEP3 再生成結果の確認 */}
                {/* ================================================ */}
                <button
                  type="button"
                  className={`mt-5 mb-3 w-full rounded-2xl border px-3 py-3 shadow-sm text-left transition-colors ${activeStep === 'step3' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-zinc-100 text-zinc-900'}`}
                  onClick={() => setActiveStepByDept((prev) => ({ ...prev, [dept.name]: activeStep === 'step3' ? 'none' : 'step3' }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className={`text-[11px] font-semibold ${activeStep === 'step3' ? 'text-white' : 'text-zinc-900'}`}>STEP3 再生成結果の確認</div>
                      <div className={`text-[11px] mt-0.5 ${activeStep === 'step3' ? 'text-zinc-200' : 'text-zinc-700'}`}>ミッションや説明、要確認事項を見直して方向性を固めます。</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700">{step3Summary}</span>
                      {activeStep === 'step3' ? <ChevronUp className="w-4 h-4 text-zinc-800" /> : <ChevronDown className="w-4 h-4 text-zinc-800" />}
                    </div>
                  </div>
                </button>
                {activeStep === 'step3' && (
                <div className="mt-3">
  {/* ✅ ミッション */}
  <div className="mt-1">
    <div className="text-xs font-bold tracking-tight text-zinc-700 mb-1.5">ミッション</div>
    <AutoResizeTextarea
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
      className="w-full rounded-2xl border border-zinc-300 p-3 text-sm leading-6"
      readOnly={!editableDept || isHydrating}
      placeholder="この部門の役割やミッションのイメージを記入してください（AIたたき台の修正もここで行います）"
      minRows={4}
      maxRows={18}
    />
  </div>

  {/* ✅ ミッション説明 */}
  <div className="mt-3">
    <div className="text-xs font-bold tracking-tight text-zinc-700 mb-1.5">ミッション説明</div>

    {/* ★ CRITICAL: deptId ベースで store から最新の department を毎回取得 */}
    {(() => {
      const storeState = useStrategyStore.getState();
      const deptFromStore = storeState.departments?.find(
        (d: Department) => (dept?.id ? d.id === dept.id : d.name === dept?.name)
      );
      const currentMissionDesc = deptFromStore?.missionDescription ?? '';

      return (
        <AutoResizeTextarea
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
          className="w-full rounded-2xl border border-zinc-300 p-3 text-sm leading-6"
          readOnly={!editableDept || isHydrating}
          placeholder="この部門のミッションを、背景・狙い・顧客価値の観点で補足してください"
          minRows={4}
          maxRows={18}
        />
      );
    })()}


  {/* ★ STAGE3拡張：再考ポイントをカテゴリ別に明示表示 */}
  {(() => {
    const correctedItems = Array.isArray(dept.reviewSummary?.correctedItems) ? dept.reviewSummary.correctedItems : [];
    const reconsiderationPoints = Array.isArray(dept.reviewSummary?.reconsiderationPoints) ? dept.reviewSummary.reconsiderationPoints : [];
    const crossDept = getCrossDeptInsightsByCategory(dept);
    const split = splitDeptReconsiderationPoints(reconsiderationPoints);
    const hasReviewBlock = correctedItems.length > 0 || reconsiderationPoints.length > 0 || crossDept.all.length > 0;

    if (!hasReviewBlock) return null;

    return (
      <div className="mt-4 space-y-3">
        {correctedItems.length > 0 && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
            <div className="text-sm font-bold tracking-tight text-zinc-900 mb-2">修正済事項</div>
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
              {correctedItems.map((item: string, i: number) => (
                <li key={`corrected-${dept.name}-${i}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 space-y-4">
          <div>
            <div className="text-sm font-bold tracking-tight text-zinc-900">再考ポイント</div>
            <p className="mt-1 text-sm leading-6 text-zinc-600">事業ポートフォリオとの整合、部門間の重複・矛盾・協力候補を確認できます。</p>
          </div>

          <div>
            <div className="text-xs font-bold tracking-tight text-zinc-700 mb-1.5">事業ポートフォリオとの整合</div>
            {split.portfolio.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
                {split.portfolio.map((item: string, i: number) => (
                  <li key={`portfolio-${dept.name}-${i}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">現時点では大きな不整合は検出されていません。</p>
            )}
          </div>

          <div>
            <div className="text-xs font-bold tracking-tight text-zinc-700 mb-1.5">重複・矛盾事項</div>
            {renderInsightList(
              [...crossDept.overlaps, ...crossDept.contradictions],
              `cross-overlap-contradiction-${dept.name}`,
              '現時点で明示的な重複・矛盾事項は検出されていません。'
            )}
          </div>

          <div>
            <div className="text-xs font-bold tracking-tight text-zinc-700 mb-1.5">協力・連携候補</div>
            {(() => {
              const collab = getUnifiedCollaborationCandidates(dept);

              if (collab.all.length === 0) {
                return <p className="text-xs text-zinc-500">現時点で明示的な協力・連携候補は検出されていません。</p>;
              }

              return (
                <div className="space-y-3">
                  {collab.intra.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold tracking-tight text-zinc-600">事業部内連携</div>
                      <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
                        {collab.intra.map((item: string, i: number) => (
                          <li key={`collab-intra-${dept.name}-${i}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {collab.inter.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold tracking-tight text-zinc-600">事業部間連携</div>
                      <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
                        {collab.inter.map((item: string, i: number) => (
                          <li key={`collab-inter-${dept.name}-${i}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {collab.cross.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-bold tracking-tight text-zinc-600">横断分析での追加候補</div>
                      <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
                        {collab.cross.map((item, i) => (
                          <li key={`collab-cross-${dept.name}-${i}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {split.remaining.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-zinc-700 mb-1">その他の確認事項</div>
              <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-zinc-700">
                {split.remaining.map((item: string, i: number) => (
                  <li key={`other-reconsideration-${dept.name}-${i}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  })()}
  </div>
</div>
                )}

                </div>

                {/* ================================================ */}
                {/* STEP4 プロジェクト案とKPI案 */}
                {/* ================================================ */}
                <button
                  type="button"
                  className={`mt-5 mb-3 w-full rounded-2xl border px-3 py-3 shadow-sm text-left transition-colors ${activeStep === 'step4' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-zinc-100 text-zinc-900'}`}
                  onClick={() => setActiveStepByDept((prev) => ({ ...prev, [dept.name]: activeStep === 'step4' ? 'none' : 'step4' }))}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className={`text-[11px] font-semibold ${activeStep === 'step4' ? 'text-white' : 'text-zinc-900'}`}>STEP4 プロジェクト案とKPI案</div>
                      <div className={`text-[11px] mt-0.5 ${activeStep === 'step4' ? 'text-zinc-200' : 'text-zinc-700'}`}>最後に、実行案としてプロジェクトとKPIを調整します。</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700">{step4Summary}</span>
                      {activeStep === 'step4' ? <ChevronUp className="w-4 h-4 text-zinc-800" /> : <ChevronDown className="w-4 h-4 text-zinc-800" />}
                    </div>
                  </div>
                </button>

                {activeStep === 'step4' && deptProjects && deptProjects.length > 0 && (
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
                          <li
                            key={resolveProjectId(p, dept.name)}
                            ref={(el) => {
                              projectRowRefs.current[`${dept.name}::${resolveProjectId(p, dept.name)}`] = el;
                            }}
                            className={`flex flex-col gap-2 rounded-2xl border px-3 py-2 bg-white/70 transition-shadow ${
                              focusedProjectKey === `${dept.name}::${resolveProjectId(p, dept.name)}`
                                ? 'ring-2 ring-zinc-300 bg-zinc-50 shadow-md'
                                : ''
                            }`}
                          >
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
                                {getProjectHypothesisText(p) && <p className="text-[11px] text-zinc-600 whitespace-pre-wrap">仮説：{getProjectHypothesisText(p)}</p>}
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
                                value={toCleanDisplayText(primaryObjective, dept.name)}
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

                                    const okrs: StoreOKR[] = [...((proj.okrs ?? []) as StoreOKR[]) ];
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

                              {krs.map((kr, ki) => (
                                <div key={ki} className="flex items-center gap-2">
                                  <span className="text-[11px] text-zinc-400 whitespace-nowrap">指標{ki + 1}</span>
                                  <input
                                    className="flex-1 text-xs text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                                    value={toCleanDisplayText(kr, dept.name)}
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
                                  <div className="text-[10px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded px-2 py-1 mt-1">
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
    <StrategyGuard mode="view">
      <CascadePageContent />
    </StrategyGuard>
  );
}
