// /components/stage1/IssueBlockPanel.tsx
'use client';

import type { ChangeEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import type { Stage1IssueBlock, StrategyState } from '@/store/strategyStore';
import type { ValueAnalysis, Stage1Benchmarks } from '@/types/strategy';
import { buildExternalIssueCandidates, type SelfMetrics, type ExternalIssueCandidatesResult, type CandidateMode } from '@/utils/stage1/benchmarkIssues';

/* ===============================
 * 定数
 * =============================== */

const METRIC_OPTIONS = [
  { key: 'operatingMargin', label: '営業利益率' },
  { key: 'revenueCAGR', label: '売上成長率' },
  { key: 'debtEquityRatio', label: 'D/Eレシオ' },
  { key: 'roic', label: 'ROIC' },
  { key: 'wacc', label: 'WACC' },
  { key: 'pbr', label: 'PBR' },
] as const;

type MetricKey = (typeof METRIC_OPTIONS)[number]['key'];

type DraftCandidate = Stage1IssueBlock & {
  draftId: string;
  category:
    | '収益性'
    | '成長性'
    | '資本効率'
    | '安全性'
    | '市場評価'
    | '資本配分'
    | 'ポートフォリオ'
    | '実行/組織'
    | '機会';
  source: 'internal' | 'external'; // 候補の出所
  evidenceKey?: string; // 重複判定用（外部候補用）
};

/* ===============================
 * 表示用フォーマット
 * =============================== */

function fmtPct(v?: number, digits = 1): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function fmtNum(v?: number, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function getBasisYears(va: ValueAnalysis | undefined): { startYear?: number; latestYear?: number } {
  const latestYear = va?.meta?.basis?.latestYear;
  const years = Array.isArray(va?.meta?.basis?.years) ? (va!.meta!.basis!.years as number[]) : [];
  const sorted = years.filter((y) => Number.isFinite(y)).slice().sort((a, b) => a - b);
  const startYear = sorted.length > 0 ? sorted[0] : undefined;
  return { startYear, latestYear };
}

/* ===============================
 * 論点たたき台生成（多め）
 * - 課題(守り)だけでなく、機会(攻め)も必ず出す
 * - 最大12件の候補を提示（ユーザーが選択して追加）
 * =============================== */

function buildIssueDraftCandidatesFromValueAnalysis(
  va: ValueAnalysis | undefined,
  waccInputPct?: number,
  opt?: {
    includeOpportunity?: boolean;
    maxCandidates?: number;
  }
): DraftCandidate[] {
  if (!va) return [];

  const waccPct = ((va as any)?.waccPct ?? waccInputPct) as number | undefined;
  const roicWaccSpread =
    typeof (va as any)?.roic === 'number' && typeof waccPct === 'number' ? ((va as any).roic as number) - (waccPct as number) : undefined;

  const includeOpportunity = opt?.includeOpportunity ?? true;
  const maxCandidates = opt?.maxCandidates ?? 12;

  const drafts: DraftCandidate[] = [];
  const { startYear, latestYear } = getBasisYears(va);
  const spanText = startYear && latestYear ? `（期間: ${startYear}→${latestYear}）` : '';

  const push = (d: Omit<DraftCandidate, 'draftId' | 'source'>) => {
    drafts.push({
      ...d,
      source: 'internal',
      draftId: `${d.scope}-${d.category}-${d.title}`.slice(0, 120),
    });
  };

  /* ---------------------------
   * 1) 収益性（営業利益率）
   * ------------------------- */
  if (Number.isFinite(va.operatingMarginPctLatest)) {
    const m = va.operatingMarginPctLatest as number;

    // 課題（低い）
    if (m < 5) {
      push({
        category: '収益性',
        title: '収益性（営業利益率）が低い',
        description:
          `最新年の営業利益率が ${fmtPct(m)} と低水準。コスト構造・価格/ミックス・生産性のどこに要因があるかを特定する必要がある。` +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['operatingMargin'],
        scope: 'company',
      });
    }

    // 機会（高い＝源泉の特定と再現性）
    if (includeOpportunity && m >= 10) {
      push({
        category: '機会',
        title: '高い収益性の源泉を特定し、再現可能な仕組みに落とす',
        description:
          `営業利益率が ${fmtPct(m)} と良好。何が利益率を支えているのか（顧客・提供価値・価格決定力・原価構造・オペレーション）を分解し、他領域でも再現できる形にする論点。` +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['operatingMargin'],
        scope: 'company',
      });
    }
  }

  /* ---------------------------
   * 2) 成長性（売上CAGR）
   * ------------------------- */
  if (Number.isFinite(va.revenueCagrPct)) {
    const g = va.revenueCagrPct as number;

    // 課題（縮小・停滞）
    if (g < 0) {
      push({
        category: '成長性',
        title: '売上が縮小基調にある',
        description: `売上CAGRが ${fmtPct(g)} でマイナス。市場/顧客/商品ポートフォリオと、営業・チャネル・提供価値のどこに論点があるかを整理する必要がある。${spanText}`,
        linkedMetrics: ['revenueCAGR'],
        scope: 'company',
      });
    } else if (g < 3) {
      push({
        category: '成長性',
        title: '売上成長率が伸び悩んでいる',
        description: `売上CAGRが ${fmtPct(g)} と低い。伸び代の源泉（新規獲得・単価・継続率・新領域）を特定する必要がある。${spanText}`,
        linkedMetrics: ['revenueCAGR'],
        scope: 'company',
      });
    }

    // 機会（高成長＝スケール課題）
    if (includeOpportunity && g >= 7) {
      push({
        category: '機会',
        title: '高成長を持続させるスケール戦略（人・供給・品質・体制）',
        description:
          `売上CAGRが ${fmtPct(g)} と高い。成長を阻害するボトルネック（採用/育成、供給能力、品質、オペレーション、プロダクト投資、資本余力）を先回りで潰し、成長の再現性を高める論点。${spanText}`,
        linkedMetrics: ['revenueCAGR'],
        scope: 'company',
      });
    }
  }

  /* ---------------------------
   * 3) 資本効率（ROIC）
   * ------------------------- */
  if (Number.isFinite(va.roic)) {
    const r = va.roic as number;

    // 課題（低い）
    if (r < 5) {
      push({
        category: '資本効率',
        title: '資本効率（ROIC）が低い可能性がある',
        description:
          `ROICが ${fmtPct(r, 2)}。投下資本（運転資本/固定資産）と収益性のどちらにボトルネックがあるかを切り分ける必要がある。` +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['roic'],
        scope: 'company',
      });
    }

    // 機会（高い＝投資拡張）
    if (includeOpportunity && r >= 10) {
      push({
        category: '資本配分',
        title: '高ROIC領域への投資拡張（成長と企業価値の最大化）',
        description:
          `ROICが ${fmtPct(r, 2)} と高い。投資原資の再配分により、ROICを毀損せず成長を加速できる領域（製品/顧客/チャネル/地域）を特定する論点。` +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['roic'],
        scope: 'company',
      });
    }
  }


  /* ---------------------------
   * 3) 価値創造（ROIC−WACC）
   * ------------------------- */
  if (waccPct == null) {
    push({
      category: '資本効率',
      title: 'WACC（資本コスト）が未入力',
      description:
        '入力タブでWACCを設定してください。ROIC−WACC（価値創造スプレッド）により、企業価値を生む状態か（資本コストを上回れているか）を判定します。',
      linkedMetrics: ['wacc'],
      scope: 'company',
    });
  } else if (!Number.isFinite((va as any).roic)) {
    // ROICがない場合は、WACCはあるが比較できない
    push({
      category: '資本効率',
      title: 'ROICが算出されていません',
      description:
        `WACCは ${fmtPct(waccPct, 2)} ですが、ROICが算出されていません。財務入力・BS情報の不足や分析更新状態を確認してください。` +
        (latestYear ? `（最新年: ${latestYear}）` : ''),
      linkedMetrics: ['roic', 'wacc'],
      scope: 'company',
    });
  } else if (typeof roicWaccSpread === 'number') {
    const r = (va as any).roic as number;
    const spread = roicWaccSpread;

    if (spread < 0) {
      push({
        category: '資本配分',
        title: '資本コスト未達（価値毀損の可能性）',
        description:
          `ROIC ${fmtPct(r, 2)} < WACC ${fmtPct(waccPct, 2)}（差分 ${spread.toFixed(2)}pt）。` +
          '収益性（利益率）・資本効率（在庫/売掛/設備）・投資配分（撤退/集中）のどこで改善するかを優先論点として整理する必要がある。' +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['roic', 'wacc'],
        scope: 'company',
      });
    } else if (spread < 0.5) {
      push({
        category: '資本効率',
        title: 'ROICとWACCがほぼ同水準（改善が必要）',
        description:
          `ROIC ${fmtPct(r, 2)} / WACC ${fmtPct(waccPct, 2)}（差分 +${spread.toFixed(2)}pt）。` +
          '小さな改善でも企業価値に効く局面。価格/ミックス、原価・固定費、生産性、運転資本回転のどこを伸ばすかを具体化する論点。' +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['roic', 'wacc'],
        scope: 'company',
      });
    } else if (includeOpportunity) {
      push({
        category: '機会',
        title: '価値創造状態（再投資余地）',
        description:
          `ROIC ${fmtPct(r, 2)} > WACC ${fmtPct(waccPct, 2)}（差分 +${spread.toFixed(2)}pt）。` +
          '価値創造を維持しながら伸ばせる領域（顧客/製品/チャネル/地域）を特定し、投資基準と資源配分を明確化する論点。' +
          (latestYear ? `（最新年: ${latestYear}）` : ''),
        linkedMetrics: ['roic', 'wacc'],
        scope: 'company',
      });
    }
  }
  /* ---------------------------
   * 4) 財務安全性（D/E）
   * ------------------------- */
  if (Number.isFinite(va.debtEquityRatio)) {
    const de = va.debtEquityRatio as number;

    // 課題（高い）
    if (de > 2) {
      push({
        category: '安全性',
        title: '財務レバレッジ（D/E）が高い',
        description: `D/Eレシオが ${fmtNum(de)}。資本政策・資金繰り余力・投資余地に制約が出ていないかを確認する必要がある。`,
        linkedMetrics: ['debtEquityRatio'],
        scope: 'company',
      });
    }

    // 機会（低い＝投資余力）
    if (includeOpportunity && de <= 0.5) {
      push({
        category: '資本配分',
        title: '財務余力を活かした成長投資（資本政策・投資基準の明確化）',
        description:
          `D/Eレシオが ${fmtNum(de)} と低く、相対的に財務余力がある。投資の優先順位（新規/既存、短期/中長期）と投資基準（期待リターン/回収期間/リスク）を明確化する論点。`,
        linkedMetrics: ['debtEquityRatio'],
        scope: 'company',
      });
    }
  }

  /* ---------------------------
   * 5) 市場評価（PBR）
   * ------------------------- */
  if (Number.isFinite(va.pbr)) {
    const p = va.pbr as number;

    // 課題（低い）
    if (p < 1) {
      push({
        category: '市場評価',
        title: '市場評価（PBR）が1倍割れの状態',
        description: `PBRが ${fmtNum(p, 2)}。市場が見ている懸念（成長性・収益性・資本効率・ガバナンス等）と、経営の打ち手の接続を整理する必要がある。`,
        linkedMetrics: ['pbr'],
        scope: 'company',
      });
    }

    // 機会（高い＝期待の源泉/持続条件）
    if (includeOpportunity && p >= 1.5) {
      push({
        category: '機会',
        title: '市場期待（PBR）を裏切らない成長ストーリーと実行基盤',
        description:
          `PBRが ${fmtNum(p, 2)} と比較的高い。市場が何を評価しているのか（将来成長・収益性・資本効率・ガバナンス）を分解し、それを継続的に実現するストーリーと実行計画に落とす論点。`,
        linkedMetrics: ['pbr'],
        scope: 'company',
      });
    }
  }

  /* ---------------------------
   * 6) 実行/組織（“良好でも必ず必要”）
   * ------------------------- */
  if (includeOpportunity) {
    push({
      category: '実行/組織',
      title: '戦略が現場の判断基準になる状態を作れているか（浸透と実行）',
      description:
        '戦略が“資料”で終わらず、現場の意思決定・優先順位・行動に落ちているかを点検する論点。部門ごとの役割とKPI/OKRが全社方針と整合しているかを確認する。',
      linkedMetrics: [],
      scope: 'company',
    });
  }

  /* ---------------------------
   * 7) 0件対策：必ず“次の成長”が出る
   * ------------------------- */
  if (drafts.length === 0) {
    push({
      category: '機会',
      title: '次の成長ドライバー（第二成長曲線）をどこで作るか',
      description:
        `主要指標は概ね良好だが、現状の強みを“再現可能な成長エンジン”として拡張できるかが次の論点。既存の成長要因（顧客/提供価値/チャネル/収益モデル）を分解し、どこを伸ばすと最もレバレッジが効くか整理する。${spanText}`,
      linkedMetrics: [],
      scope: 'company',
    });

    push({
      category: '資本配分',
      title: '資本配分（投資余力）をどこに集中させるか',
      description:
        `短期の最適化だけでなく、中長期の成長と企業価値向上に向けて、投資優先順位と投資基準（期待リターン/リスク/回収期間）を明確化する必要がある。` +
        (latestYear ? `（最新年: ${latestYear}）` : ''),
      linkedMetrics: [],
      scope: 'company',
    });
  }

  // 重複っぽいものを軽く除去（title一致）
  const uniq: DraftCandidate[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const k = d.title.trim();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(d);
  }

  return uniq.slice(0, maxCandidates);
}

/* ===============================
 * 候補統合ユーティリティ
 * =============================== */

/**
 * 外部候補（IssueBlock）をDraftCandidateに変換
 */
function convertExternalCandidate(
  externalCand: ReturnType<typeof buildExternalIssueCandidates>['candidates'][number],
  index: number
): DraftCandidate {
  // evidence キーを生成（重複判定用）
  const evidenceKey = (externalCand as any).evidence
    ? `${(externalCand as any).evidence.benchmarkId}-${(externalCand as any).evidence.metricKey}`
    : `external-${index}`;

  return {
    ...externalCand,
    source: 'external',
    category: '機会', // 外部候補はとりあえず「機会」カテゴリ
    draftId: `external-${index}-${externalCand.title}`.slice(0, 120),
    evidenceKey,
  };
}

/**
 * 内部候補と外部候補を統合して最大12件にする
 * 優先順位: 外部候補(3件まで) + 内部候補(残り)
 */
function mergeAndPrioritizeCandidates(
  internalCandidates: DraftCandidate[],
  externalCandidates: typeof buildExternalIssueCandidates extends (...args: any[]) => infer R
    ? R extends { candidates: infer C }
      ? C
      : never
    : never
): DraftCandidate[] {
  const maxExternal = 3;
  const maxTotal = 12;

  // 外部候補を統合型に変換
  const convertedExternal = externalCandidates
    .slice(0, maxExternal)
    .map((cand, idx) => convertExternalCandidate(cand, idx));

  // 重複を除外（内部候補のタイトル、または外部候補のevidenceKeyで）
  const externalTitles = new Set(convertedExternal.map((c) => c.title));
  const externalEvidenceKeys = new Set(convertedExternal.map((c) => c.evidenceKey));

  const filteredInternal = internalCandidates.filter((ic) => {
    // 外部とのタイトル重複を避ける
    if (externalTitles.has(ic.title)) return false;
    return true;
  });

  // 統合: 外部優先 + 内部で補充
  const merged = [...convertedExternal, ...filteredInternal].slice(0, maxTotal);

  return merged;
}

/**
 * 候補をフィルタ
 */
function filterCandidates(
  candidates: DraftCandidate[],
  filterMode: 'all' | 'internal' | 'external'
): DraftCandidate[] {
  if (filterMode === 'internal') return candidates.filter((c) => c.source === 'internal');
  if (filterMode === 'external') return candidates.filter((c) => c.source === 'external');
  return candidates;
}

/* ===============================
 * コンポーネント
 * =============================== */

export default function IssueBlockPanel({ disabled }: { disabled?: boolean } = {}) {
  const issues = useStrategyStore((s: StrategyState) => (Array.isArray(s.stage1Issues) ? s.stage1Issues : []));
  const setStage1Issues = useStrategyStore((s: StrategyState) => s.setStage1Issues);

  const valueAnalysis = useStrategyStore((s: StrategyState) => s.valueAnalysis);

  const waccInputPct = useStrategyStore((s: StrategyState) => {
    const anyS = s as any;
    const candidates = [
      anyS?.stage1Benchmarks?.waccManual,
      anyS?.stage1Inputs?.waccPct,
      anyS?.stage1Inputs?.wacc,
      anyS?.companyTarget?.waccPct,
      anyS?.companyTarget?.wacc,
      anyS?.metricsSummary?.waccPct,
      anyS?.metricsSummary?.wacc,
      anyS?.waccPct,
      anyS?.wacc,
    ];
    for (const v of candidates) {
      const n = typeof v === 'string' ? Number(v) : v;
      if (Number.isFinite(n) && n > 0) return n as number;
    }
    return undefined;
  });

  const recomputeValueAnalysis = useStrategyStore((s: StrategyState) => s.recomputeValueAnalysis);
  const benchmarks = useStrategyStore((s: StrategyState) => (s as any).stage1Benchmarks);
  const isListed = useStrategyStore((s: StrategyState) => s.isListed ?? false);

  const [infoMessage, setInfoMessage] = useState<string>('');
  const [showDrafts, setShowDrafts] = useState<boolean>(true);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [candidateMode, setCandidateMode] = useState<CandidateMode>('weakness');
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'internal' | 'external'>('all');

  // ========== 外部比較候補の計算 ==========
  const selfMetrics = useMemo<SelfMetrics | undefined>(() => {
    if (!valueAnalysis) return undefined;
    return {
      growthPct: (valueAnalysis as any).revenueCagrPct,
      opMarginPct: (valueAnalysis as any).operatingMarginPctLatest,
      roicPct: (valueAnalysis as any).roic,
      pbr: (valueAnalysis as any).pbr,
      // capitalTurnover はまだ valueAnalysis に無い
    };
  }, [valueAnalysis]);

  const externalCandidatesResult = useMemo<ExternalIssueCandidatesResult>(() => {
    return buildExternalIssueCandidates(selfMetrics, benchmarks, { isListed, mode: candidateMode });
    // refreshKey を依存に入れることで、明示的な再計算をトリガーできる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfMetrics, benchmarks, isListed, candidateMode, refreshKey]);

  const externalIssueCandidates = externalCandidatesResult.candidates;
  const externalCandidatesDebug = externalCandidatesResult.debug;

  // 候補を再計算するハンドラ
  const handleRefreshCandidates = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
    setInfoMessage('候補を更新しました');
    setTimeout(() => setInfoMessage(''), 2500);
  }, []);

  // ★ 診断ログ：valueAnalysis の状態確認（A-1）
  if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[IssueBlockPanel] valueAnalysis state:', {
      revenueCagrPct: (valueAnalysis as any)?.revenueCagrPct,
      operatingMarginPctLatest: (valueAnalysis as any)?.operatingMarginPctLatest,
      basis_years: (valueAnalysis as any)?.meta?.basis?.years,
      basis_latestYear: (valueAnalysis as any)?.meta?.basis?.latestYear,
      meta_source: (valueAnalysis as any)?.meta?.source,
      has_valueAnalysis: !!valueAnalysis,
    });
  }

  // ★ 内部候補（最大12件）
  const internalCandidates = useMemo(() => {
    const candidates = buildIssueDraftCandidatesFromValueAnalysis(valueAnalysis, waccInputPct, { includeOpportunity: true, maxCandidates: 12 });

    // ★ 診断ログ：候補生成時の valueAnalysis 確認
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      console.log('[IssueBlockPanel] 論点候補生成後', {
        revenueCagrPct: (valueAnalysis as any)?.revenueCagrPct,
        basis_years: (valueAnalysis as any)?.meta?.basis?.years,
        basis_latestYear: (valueAnalysis as any)?.meta?.basis?.latestYear,
        candidatesCount: candidates.length,
      });
    }

    return candidates;
  }, [valueAnalysis]);

  // ★ 内部 + 外部候補を統合（最大12件）
  const allCandidates = useMemo(() => {
    const merged = mergeAndPrioritizeCandidates(internalCandidates, externalIssueCandidates);
    return merged;
  }, [internalCandidates, externalIssueCandidates]);

  // ★ フィルタ適用
  const filteredCandidates = useMemo(() => {
    return filterCandidates(allCandidates, candidateFilter);
  }, [allCandidates, candidateFilter]);

  // ★ 候補の選択状態（draftIdのSet）
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());

  const remainingSlots = Math.max(0, 5 - issues.length);

  const toggleDraft = useCallback((draftId: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(draftId)) next.delete(draftId);
      else next.add(draftId);
      return next;
    });
  }, []);

  const selectAllDrafts = useCallback(() => {
    setSelectedDraftIds(new Set(filteredCandidates.map((d) => d.draftId)));
  }, [filteredCandidates]);

  const clearAllDrafts = useCallback(() => {
    setSelectedDraftIds(new Set());
  }, []);

  const addIssue = useCallback(() => {
    if (issues.length >= 5) return;
    setStage1Issues([...issues, { title: '', description: '', linkedMetrics: [], scope: 'company' }]);
  }, [issues, setStage1Issues]);

  const updateIssue = useCallback(
    (index: number, patch: Partial<Stage1IssueBlock>) => {
      const next = [...issues];
      next[index] = { ...next[index], ...patch };
      setStage1Issues(next);
    },
    [issues, setStage1Issues]
  );

  const removeIssue = useCallback(
    (index: number) => {
      setStage1Issues(issues.filter((_, i) => i !== index));
    },
    [issues, setStage1Issues]
  );

  const handleRecompute = useCallback(() => {
    console.log('[IssueBlockPanel] 分析を更新 clicked');

    // ★ 診断ログ：recompute 前の valueAnalysis
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      console.log('[IssueBlockPanel] recompute before:', {
        revenueCagrPct: (valueAnalysis as any)?.revenueCagrPct,
        basis_years: (valueAnalysis as any)?.meta?.basis?.years,
        basis_latestYear: (valueAnalysis as any)?.meta?.basis?.latestYear,
      });
    }

    if (!recomputeValueAnalysis) {
      console.warn('[IssueBlockPanel] recomputeValueAnalysis not found in store');
      setInfoMessage('分析関数がstoreに見つかりません');
      setTimeout(() => setInfoMessage(''), 2500);
      return;
    }

    try {
      console.log('[IssueBlockPanel] calling recomputeValueAnalysis("local")');
      recomputeValueAnalysis('local');

      // ★ 診断ログ：recompute 後の valueAnalysis（非同期なため、次のイベントループで確認）
      setTimeout(() => {
        if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
          const updatedVA = useStrategyStore.getState().valueAnalysis;
          console.log('[IssueBlockPanel] recompute after (async):', {
            revenueCagrPct: (updatedVA as any)?.revenueCagrPct,
            basis_years: (updatedVA as any)?.meta?.basis?.years,
            basis_latestYear: (updatedVA as any)?.meta?.basis?.latestYear,
          });
        }
      }, 50);

      setInfoMessage('✓ 分析を更新しました');
      setTimeout(() => setInfoMessage(''), 2000);
    } catch (e) {
      console.error('[IssueBlockPanel] recompute error:', e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      setInfoMessage(`分析の更新に失敗：${errorMsg}`);
      setTimeout(() => setInfoMessage(''), 3500);
    }
  }, [recomputeValueAnalysis, valueAnalysis]);

  const handleAddSelectedDrafts = useCallback(() => {
    if (remainingSlots <= 0) {
      setInfoMessage('これ以上追加できません（最大5件）');
      setTimeout(() => setInfoMessage(''), 2000);
      return;
    }

    const selected = filteredCandidates.filter((d) => selectedDraftIds.has(d.draftId));
    if (selected.length === 0) {
      setInfoMessage('追加する候補を選択してください');
      setTimeout(() => setInfoMessage(''), 2000);
      return;
    }

    // 追加は残枠まで
    const toAdd = selected.slice(0, remainingSlots).map((d) => ({
      title: d.title,
      description: d.description,
      linkedMetrics: Array.isArray(d.linkedMetrics) ? d.linkedMetrics : [],
      scope: d.scope,
    }));

    const next = [...issues, ...toAdd].slice(0, 5);
    setStage1Issues(next);

    setInfoMessage(`論点を${toAdd.length}件追加しました`);
    setTimeout(() => setInfoMessage(''), 2500);

    // 追加済みは選択解除（任意）
    setSelectedDraftIds((prev) => {
      const nextSel = new Set(prev);
      for (const d of selected.slice(0, remainingSlots)) nextSel.delete(d.draftId);
      return nextSel;
    });
  }, [filteredCandidates, issues, remainingSlots, selectedDraftIds, setStage1Issues]);

  const hasIssues = issues.length > 0;
  const hasAllCandidates = allCandidates.length > 0;
  const filteredCount = filteredCandidates.length;
  const internalCount = allCandidates.filter((c) => c.source === 'internal').length;
  const externalCount = allCandidates.filter((c) => c.source === 'external').length;

  // 外部比較候補を追加
  const handleAddExternalCandidate = useCallback(
    (candidateIssue: typeof externalIssueCandidates[number]) => {
      // 重複防止：タイトルが同じなら追加しない（簡易版）
      const isDuplicate = issues.some((iss) => iss.title === candidateIssue.title);
      if (isDuplicate) {
        setInfoMessage('同じ内容の論点が既に存在します');
        setTimeout(() => setInfoMessage(''), 2000);
        return;
      }

      const next = [...issues, candidateIssue];
      setStage1Issues(next);
      setInfoMessage(`外部比較の論点を追加しました`);
      setTimeout(() => setInfoMessage(''), 2500);
    },
    [issues, setStage1Issues]
  );

  // 外部比較候補をすべて追加
  const handleAddAllExternalCandidates = useCallback(() => {
    if (externalIssueCandidates.length === 0) {
      setInfoMessage('追加できる候補がありません');
      setTimeout(() => setInfoMessage(''), 2000);
      return;
    }

    // 重複を除外して追加
    const toAdd = externalIssueCandidates.filter(
      (cand) => !issues.some((iss) => iss.title === cand.title)
    );

    if (toAdd.length === 0) {
      setInfoMessage('追加できる候補がありません（すべて既存の論点と重複）');
      setTimeout(() => setInfoMessage(''), 2000);
      return;
    }

    const next = [...issues, ...toAdd];
    setStage1Issues(next);
    setInfoMessage(`${toAdd.length}個の論点を追加しました`);
    setTimeout(() => setInfoMessage(''), 2500);
  }, [externalIssueCandidates, issues, setStage1Issues]);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">次の一手（論点）</h2>

      <p className="text-sm text-gray-600 mb-6">
        財務指標を踏まえ、経営として向き合うべき論点を整理します。解決策や戦略はここでは書かず、
        「何が論点か」を議論し明確にしてください。
      </p>

      {/* ========== 統合候補セクション＋外部ステータス ========== */}
      {externalCount > 0 && (
        <div className="border border-blue-300 rounded-lg p-4 mb-6 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm">外部比較からの論点候補（{externalCount}件）</div>
            <button
              onClick={handleRefreshCandidates}
              className="px-3 py-1 text-xs font-semibold rounded border border-blue-400 bg-white text-blue-600 hover:bg-blue-100 transition"
            >
              ↻ 候補を更新
            </button>
          </div>

          {/* 候補タイプ選択トグル */}
          <div className="flex items-center gap-3 mb-3 text-xs">
            <span className="text-gray-700 font-medium">候補タイプ：</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="candidate-mode"
                value="weakness"
                checked={candidateMode === 'weakness'}
                onChange={(e) => setCandidateMode(e.target.value as CandidateMode)}
                className="w-3 h-3"
              />
              <span className="text-gray-700">課題</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="candidate-mode"
                value="strength"
                checked={candidateMode === 'strength'}
                onChange={(e) => setCandidateMode(e.target.value as CandidateMode)}
                className="w-3 h-3"
              />
              <span className="text-gray-700">強み</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="candidate-mode"
                value="both"
                checked={candidateMode === 'both'}
                onChange={(e) => setCandidateMode(e.target.value as CandidateMode)}
                className="w-3 h-3"
              />
              <span className="text-gray-700">両方</span>
            </label>
          </div>

          {/* ステータス情報 */}
          <div className="bg-white border border-blue-200 rounded p-3 space-y-1 text-xs text-gray-700">
            <div>
              <span className="font-semibold">ベンチマーク：</span>
              {benchmarks?.industryMedian
                ? `✓ 業界中央値（${benchmarks.industryMedian.period || '未指定'}）`
                : '✗ 未入力'}
            </div>
            <div>
              <span className="font-semibold">自社指標：</span>
              {externalCandidatesDebug.missingSelfMetrics.length === 0
                ? '✓ OK'
                : `✗ 不足（${externalCandidatesDebug.missingSelfMetrics.join(', ')}）`}
            </div>
          </div>
        </div>
      )}

      <div className="border rounded p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700">
          <div className="font-semibold">論点作成の進め方</div>
          <div className="text-xs text-gray-500 mt-1">
            「課題（守り）」だけでなく「機会（攻め）」も候補として提示します。まずは候補から選択して追加すると速いです。
          </div>
          {infoMessage && <div className="text-xs text-green-700 mt-2">{infoMessage}</div>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRecompute}
            className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            分析を更新
          </button>

          <button
            onClick={() => setShowDrafts((v) => !v)}
            className="px-4 py-2 text-sm font-semibold rounded transition bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {showDrafts ? '候補を隠す' : '候補を表示'}
          </button>
        </div>
      </div>

      {/* ★ 統合候補一覧 */}
      {showDrafts && (
        <div className="bg-gray-50 border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="font-semibold text-sm">論点候補（{allCandidates.length}/12件）</div>
              <div className="text-xs text-gray-600 mt-1">
                追加したい候補にチェックを付けてください（残り{remainingSlots}件まで追加できます）
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={selectAllDrafts}
                disabled={!hasAllCandidates}
                className="px-3 py-1.5 text-xs font-semibold rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                全選択
              </button>
              <button
                onClick={clearAllDrafts}
                disabled={selectedDraftIds.size === 0}
                className="px-3 py-1.5 text-xs font-semibold rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                解除
              </button>
              <button
                onClick={handleAddSelectedDrafts}
                disabled={selectedDraftIds.size === 0 || remainingSlots <= 0}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500"
              >
                選択した論点を追加
              </button>
            </div>
          </div>

          {/* フィルタタブ */}
          <div className="flex items-center gap-2 mb-3 border-b">
            {(['all', 'internal', 'external'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setCandidateFilter(mode)}
                className={`px-3 py-2 text-xs font-semibold transition border-b-2 -mb-1 ${
                  candidateFilter === mode
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-600 border-transparent hover:text-gray-700'
                }`}
              >
                {mode === 'all'
                  ? `すべて（${allCandidates.length}）`
                  : mode === 'internal'
                    ? `内部（${internalCount}）`
                    : `外部比較（${externalCount}）`}
              </button>
            ))}
          </div>

          {!hasAllCandidates ? (
            <div className="text-sm text-gray-600 mt-4">
              <div className="font-semibold mb-2">💡 候補を生成できません。理由：</div>
              {internalCount === 0 && externalCount === 0 && (
                <div>
                  {!benchmarks?.industryMedian ? (
                    <div>・外部比較の業界中央値が未入力です</div>
                  ) : (
                    <div>・数値が不足している場合は「分析を更新」を押してください</div>
                  )}
                </div>
              )}
            </div>
          ) : filteredCount === 0 ? (
            <div className="text-sm text-gray-600 mt-4">
              <div>このフィルタには候補がありません</div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredCandidates.map((d) => {
                const checked = selectedDraftIds.has(d.draftId);
                return (
                  <label
                    key={d.draftId}
                    className={`border rounded-lg p-3 cursor-pointer transition bg-white hover:bg-gray-50 ${
                      checked ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => toggleDraft(d.draftId)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                            {d.category}
                          </span>
                          {d.source === 'external' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">
                              外部比較
                            </span>
                          )}
                          <span className="font-semibold text-sm truncate">{d.title}</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-1 leading-relaxed">
                          {d.description}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                          <span>対象: {d.scope === 'company' ? '全社' : '事業'}</span>
                          {Array.isArray(d.linkedMetrics) && d.linkedMetrics.length > 0 && (
                            <span>
                              根拠: {d.linkedMetrics.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!hasIssues && (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 mb-6">
          <div className="font-semibold mb-2">まだ論点が登録されていません</div>
          <div className="text-sm text-gray-600">
            まずは次のどちらかで開始してください。
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>上の「論点候補」から選択して追加</li>
              <li>下の「論点を追加」から手動で入力</li>
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {issues.map((issue, index) => (
          <IssueEditor
            key={index}
            index={index}
            issue={issue}
            onChange={(patch) => updateIssue(index, patch)}
            onRemove={() => removeIssue(index)}
            benchmarks={benchmarks}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={addIssue}
          disabled={issues.length >= 5}
          className="border px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          論点を追加
        </button>
        <div className="text-sm text-gray-500">{issues.length}/5</div>
      </div>
    </section>
  );
}

/* ===============================
 * Issue 編集ブロック
 * =============================== */

function buildBenchmarkComparison(benchmarks: Stage1Benchmarks | undefined): string {
  if (!benchmarks?.industryMedian?.metrics) return '';

  const im = benchmarks.industryMedian.metrics;
  const parts: string[] = [];

  if (im.opMarginPct !== undefined && Number.isFinite(im.opMarginPct)) {
    parts.push(`営業利益率 ${im.opMarginPct > 0 ? '+' : ''}${im.opMarginPct.toFixed(1)}pt`);
  }
  if (im.roicPct !== undefined && Number.isFinite(im.roicPct)) {
    parts.push(`ROIC ${im.roicPct > 0 ? '+' : ''}${im.roicPct.toFixed(1)}pt`);
  }

  return parts.length > 0 ? `業界中央値比：${parts.join(' / ')}` : '';
}

function IssueEditor({
  index,
  issue,
  onChange,
  onRemove,
  benchmarks,
}: {
  index: number;
  issue: Stage1IssueBlock;
  onChange: (patch: Partial<Stage1IssueBlock>) => void;
  onRemove: () => void;
  benchmarks?: Stage1Benchmarks;
}) {
  const benchmarkComparison = buildBenchmarkComparison(benchmarks);

  return (
    <div className="border rounded p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">論点 {index + 1}</h3>
        <button className="text-sm text-red-500" onClick={onRemove}>
          削除
        </button>
      </div>

      {benchmarkComparison && (
        <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded px-2 py-1">
          外部比較根拠：{benchmarkComparison}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium">論点タイトル</label>
        <input
          className="border px-3 py-2 w-full"
          placeholder="例：収益性が業界水準を下回っている"
          value={issue.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">論点の説明</label>
        <textarea
          className="border px-3 py-2 w-full"
          rows={3}
          placeholder="どの指標が、どのような状態にあるため論点と考えるか"
          value={issue.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">根拠となる指標</label>
        <div className="flex flex-wrap gap-3">
          {METRIC_OPTIONS.map((m) => {
            const checked = Array.isArray(issue.linkedMetrics) && issue.linkedMetrics.includes(m.key);
            return (
              <label key={m.key} className="text-sm flex gap-1 items-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const current = Array.isArray(issue.linkedMetrics) ? issue.linkedMetrics : [];
                    const next: MetricKey[] = e.target.checked
                      ? ([...current, m.key] as MetricKey[])
                      : (current.filter((k) => k !== m.key) as MetricKey[]);
                    onChange({ linkedMetrics: next });
                  }}
                />
                {m.label}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">対象範囲</label>
        <select
          className="border px-3 py-2"
          value={issue.scope}
          onChange={(e) => onChange({ scope: e.target.value as Stage1IssueBlock['scope'] })}
        >
          <option value="company">全社</option>
          <option value="business">事業</option>
        </select>
      </div>
    </div>
  );
}
