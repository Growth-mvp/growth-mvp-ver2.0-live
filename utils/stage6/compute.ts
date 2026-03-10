/**
 * STAGE6 主要計算ロジック
 * - North Star マッピング
 * - 達成率・ギャップ計算
 * - Issue 解決度計算
 * - 寄与度スコア計算
 */

import type { YearlyPL } from '@/utils/financeSimulation';
import {
  buildBridgeDeltas,
  type BridgeInput,
  type BridgeKR,
} from '@/utils/simulationBridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
} from '@/utils/financeSimulation';

/* =========================================================
 * Format/Display Utilities
 * ======================================================= */

/**
 * 日本円表示（フォーマット）
 */
export function fmtJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });
}

/**
 * 日本円コンパクト表示（単位圧縮）
 */
export function compactJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v.toFixed(0)}`;
}

/**
 * CompanyTarget ラベルから YearlyPL の値を抽出
 * ラベルのキーワードベースで該当する指標を返す
 */
export function extractMetricFromYearlyPL(
  yearly: YearlyPL[] | undefined,
  label: string,
  dueYear?: number
): number | undefined {
  if (!yearly || yearly.length === 0) return undefined;

  // dueYear がある場合はそこを見る、ない場合は末尾を見る
  const targetYear = dueYear ?? yearly[yearly.length - 1]?.year;
  const row = yearly.find((y) => y.year === targetYear);
  if (!row) return undefined;

  const lowerLabel = label.toLowerCase();

  // 売上系
  if (lowerLabel.includes('売上') && !lowerLabel.includes('成長')) {
    return row.revenue;
  }

  // 営業利益率
  if (lowerLabel.includes('営業利益率') || lowerLabel.includes('利益率')) {
    if ((row.revenue ?? 0) === 0) return undefined;
    return ((row.op_income ?? 0) / (row.revenue ?? 0)) * 100;
  }

  // 営業利益
  if (lowerLabel.includes('営業利益')) {
    return row.op_income;
  }

  // 成長率（CAGR）：簡易版（末尾2年の成長率）
  if (lowerLabel.includes('成長率') || lowerLabel.includes('cagr')) {
    if (yearly.length < 2) return undefined;
    const first = yearly[0];
    const last = yearly[yearly.length - 1];
    if (!first?.revenue || !last?.revenue || first.revenue === 0) return undefined;
    const years = last.year - first.year;
    if (years <= 0) return undefined;
    const cagr = Math.pow(last.revenue / first.revenue, 1 / years) - 1;
    return cagr * 100; // %
  }

  return undefined;
}

/**
 * ★Phase E 修正: Unit canonicalization
 * unit 文字列を統一形式に正規化（百万円 → million_yen など）
 */
export function canonicalizeUnit(unit: unknown): string | undefined {
  if (!unit) return undefined;

  const u = String(unit).trim().toLowerCase();

  // 百万円系
  if (u.includes('百万') || u === 'mjpy' || u === 'million_yen') {
    return 'million_yen';
  }

  // 千円系
  if (u.includes('千') || u === 'kjpy' || u === 'thousand_yen') {
    return 'thousand_yen';
  }

  // 円系
  if (u === '円' || u === 'jpy' || u === '¥' || u === 'yen') {
    return 'yen';
  }

  // パーセント系
  if (u === '%' || u === 'percent') {
    return 'percent';
  }

  // その他はそのまま
  return u;
}

/**
 * E-1: Unit normalization utility（★拡張版）
 *
 * fromUnit から toUnit への値変換
 * 内部計算用途：yen 統一で計算 → 表示は target.unit に変換
 *
 * サポート：
 * - "百万円" / "MJPY" ← → "千円" / "KJPY" ← → "円" / "JPY" / "¥"
 * - "%" は変換しない
 */
export function normalizeValueToUnit(
  value: number | undefined,
  fromUnit: string | undefined,
  toUnit?: string | undefined
): number | undefined {
  if (value === undefined) return undefined;

  // 引数が2個の場合（後方互換）：fromUnit は toUnit、デフォルト fromUnit="yen"
  if (toUnit === undefined) {
    // normalizeValueToUnit(valueInYen, targetUnit) → yen から targetUnit へ
    const canonTo = canonicalizeUnit(fromUnit);
    if (!canonTo) return value;

    // money 換算
    if (canonTo === 'million_yen') {
      return value / 1_000_000;
    }
    if (canonTo === 'thousand_yen') {
      return value / 1_000;
    }
    if (canonTo === 'yen' || canonTo === 'percent') {
      return value;
    }

    return value;
  }

  // 引数が3個の場合：fromUnit から toUnit へ
  const canonFrom = canonicalizeUnit(fromUnit);
  const canonTo = canonicalizeUnit(toUnit);

  if (!canonFrom || !canonTo) return value;
  if (canonFrom === canonTo) return value; // 同じ単位ならそのまま

  // money 換算（yen を中間値として経由）
  // fromUnit -> yen
  let valueYen = value;
  if (canonFrom === 'million_yen') {
    valueYen = value * 1_000_000;
  } else if (canonFrom === 'thousand_yen') {
    valueYen = value * 1_000;
  }
  // yen のまま（canonFrom === 'yen'）

  // yen -> toUnit
  if (canonTo === 'million_yen') {
    return valueYen / 1_000_000;
  }
  if (canonTo === 'thousand_yen') {
    return valueYen / 1_000;
  }
  if (canonTo === 'yen' || canonTo === 'percent') {
    return valueYen;
  }

  return value;
}

/**
 * 達成率を計算
 */
export function calculateAchievementRate(
  forecastValue: number | undefined,
  targetBase: number | undefined
): number | undefined {
  if (forecastValue === undefined || targetBase === undefined || targetBase === 0) return undefined;
  return (forecastValue / targetBase) * 100;
}

/**
 * Step D-1: 予測値の内訳（トップ3プロジェクト）を計算
 * 各CompanyTargetに対して「どのプロジェクトが寄与したか」を表示するための補助関数
 */
export function getTopContributingProjects(
  _targetLabel: string,
  projectContrib: any[],
  maxCount: number = 3
): Array<{ proj: string; dept: string; contribution: number }> {
  // 簡易版：各プロジェクトの営業利益差分でランキング（簡易的に）
  const sorted = projectContrib
    .filter((p) => Math.abs(p.deltaOpTotal) > 0)
    .sort((a, b) => Math.abs(b.deltaOpTotal) - Math.abs(a.deltaOpTotal))
    .slice(0, maxCount);

  return sorted.map((p) => ({
    proj: p.proj,
    dept: p.dept,
    contribution: p.deltaOpTotal,
  }));
}

/**
 * プロジェクトから STAGE4 計画値ヒントを抽出
 * 戻り値：{ source, confidence, notes }
 */
export function getEvidenceFromProject(project: any): {
  source: 'kr_bridge' | 'stage4_plan' | 'estimated';
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
} {
  // Step B方針：計画値がある → 高信頼、無い → 推定 (低信頼)

  // STAGE4 の skillPlans / executionHumanInvestments から「実行計画」の有無を判定
  const hasSkillPlan = Array.isArray(project.skillPlans) && project.skillPlans.length > 0;
  const hasExecInvest =
    Array.isArray(project.executionHumanInvestments) && project.executionHumanInvestments.length > 0;
  const hasExecPlan = hasSkillPlan || hasExecInvest;

  // STAGE4 planStatus = 'approved' なら根拠が確定
  const isApproved = project.planStatus === 'approved';

  if (isApproved && hasExecPlan) {
    return {
      source: 'stage4_plan',
      confidence: 'high',
      notes: 'STAGE4実行計画に基づく',
    };
  }

  if (hasExecPlan) {
    return {
      source: 'stage4_plan',
      confidence: 'medium',
      notes: 'STAGE4計画値（レビュー中）',
    };
  }

  // デフォルト：KRブリッジベース
  return {
    source: 'kr_bridge',
    confidence: 'low',
    notes: 'KR推定（計画値未確定）',
  };
}

/**
 * Yearly差分を計算
 */
export function diffYearly(a: YearlyPL[], b: YearlyPL[]): YearlyPL[] {
  const mapA = new Map<number, YearlyPL>();
  a.forEach((x) => mapA.set(x.year, x));

  return b.map((x) => {
    const y = mapA.get(x.year);
    if (!y) return { ...x };

    const revenue = (x.revenue ?? 0) - (y.revenue ?? 0);
    const op_income = (x.op_income ?? 0) - (y.op_income ?? 0);
    const margin = revenue !== 0 ? op_income / revenue : 0;

    return { ...x, revenue, op_income, margin };
  });
}

/**
 * Yearly 合計を計算
 */
export function sumYearly(rows: YearlyPL[], key: 'revenue' | 'op_income'): number {
  return rows.reduce((s, r) => s + (Number((r as any)[key]) || 0), 0);
}

/* =========================================================
 * North Star 関連（タブ2用）
 * ======================================================= */

/**
 * North Star 比較行を生成
 *
 * E-1 修正: forecastValue を target.unit に正規化してから計算
 */
export function buildNorthStarRows(args: {
  companyTargets: any[];
  yearlyAll: { low?: any[]; base?: any[]; high?: any[] } | undefined;
  scenarioKey: 'low' | 'base' | 'high';
  projectContrib: any[];
}): Array<{
  targetId: string;
  label: string;
  unit: string;
  dueYear?: number;
  low?: number;
  base: number;
  high?: number;
  forecastValue?: number;
  gap?: number;
  achievementRate?: number;
  breakdown?: Array<{
    projectId: string;
    delta: number;
    executionWeight: number;
    contribution: number;
    effectiveDelta: number;
  }>;
  topProjects?: Array<{
    projectId: string;
    proj: string;
    dept: string;
    delta: number;
    executionWeight: number;
    effectiveDelta: number;
    contribution: number;
  }>;
}> {
  const { companyTargets, yearlyAll, scenarioKey, projectContrib } = args;

  if (!companyTargets || !Array.isArray(companyTargets)) return [];

  const forecastYearly = yearlyAll?.[scenarioKey] ?? [];

  return companyTargets.map((target) => {
    // ★ TASK-3: unit を先に正規化（百万円 → million_yen など）
    const normalizedUnit = canonicalizeUnit(target.unit);
    if (!normalizedUnit || normalizedUnit === '') {
      console.warn('[TASK-3] Unknown unit in companyTarget', {
        targetLabel: target.label,
        rawUnit: target.unit,
      });
      // fallback なし（処理を止める）
      return {
        targetId: target.id,
        label: target.label,
        unit: target.unit,
        dueYear: target.dueYear,
        base: target.base,
        forecastValue: undefined,
        gap: undefined,
        achievementRate: undefined,
      };
    }

    // 1. yearlyPL から取得（通常は円単位）
    const rawForecast = extractMetricFromYearlyPL(forecastYearly, target.label, target.dueYear);

    // 2. ★Phase E 修正: yen 統一で計算（単位混在対策の根本解決）
    // rawForecast は yen 単位、rawBase を yen に正規化（normalizedUnit を使用）
    const baseYen = normalizeValueToUnit(target.base, normalizedUnit, 'yen') ?? target.base;

    // achievementRate は yen ベースで計算（★重要）
    const achievement = baseYen > 0 && rawForecast !== undefined ? (rawForecast / baseYen) * 100 : undefined;
    const gapYen = rawForecast !== undefined && baseYen ? rawForecast - baseYen : undefined;

    // 3. 表示用に normalizedUnit に変換（保存されたunitを尊重）
    const forecastDisplay = normalizeValueToUnit(rawForecast, 'yen', normalizedUnit);
    const gapDisplay = gapYen !== undefined ? normalizeValueToUnit(gapYen, 'yen', normalizedUnit) : undefined;

    // Note: breakdown は Phase E (phaseE.ts) で詳細に計算されるため、
    // ここでは topProjects 情報がある場合のみ簡易形式を返す
    const topContributors = getTopContributingProjects(target.label, projectContrib, 3);

    return {
      targetId: target.id,
      label: target.label,
      unit: target.unit,
      dueYear: target.dueYear,
      low: target.low,
      base: target.base,
      high: target.high,
      forecastValue: forecastDisplay,  // ★target.unit で表示
      gap: gapDisplay,                 // ★target.unit で表示
      achievementRate: achievement,    // ★yen ベースで計算
      // topProjects のみ返す（breakdown は Phase E で詳細に計算）
      topProjects: topContributors.length > 0
        ? topContributors.map((proj: any) => ({
            projectId: proj.key || '',
            proj: proj.proj,
            dept: proj.dept,
            delta: 0, // 未計算
            executionWeight: 1,
            effectiveDelta: proj.contribution ?? 0,
            contribution: proj.contribution ?? 0,
          }))
        : undefined,
    };
  });
}

/* =========================================================
 * Issue Resolution 関連（タブ3用）
 * ======================================================= */

/**
 * 論点解決度を計算
 * Issue → 紐付く Target（linkedIssueIds 参照）→ achievementRate を集計
 */
export function buildIssueResolutions(args: {
  stage1Issues: any[];
  companyTargets: any[];
  northStarRows: Array<{
    targetId: string;
    label: string;
    unit: string;
    achievementRate?: number;
  }>;
}): Array<{
  issueTitle: string;
  issueDescription: string;
  linkedMetrics?: string[];
  linkedTargets: string[];
  resolutionRate?: number;
  resolutionStatus: 'unconnected' | 'partial' | 'in_progress' | 'achieved';
}> {
  const { stage1Issues, companyTargets, northStarRows } = args;

  if (!stage1Issues || !Array.isArray(stage1Issues)) return [];

  return stage1Issues.map((issue) => {
    // Issue に紐づく Targets を取得（companyTargets.linkedIssueIds に issue.title が含まれるもの）
    const linkedTargets = companyTargets.filter((t) =>
      (t.linkedIssueIds ?? []).includes(issue.title)
    );

    // 紐付き Target の label を収集
    const linkedTargetLabels = linkedTargets.map((t) => t.label);

    // achievementRate を平均して resolutionRate を計算
    let resolutionRate: number | undefined;
    let resolutionStatus: 'unconnected' | 'partial' | 'in_progress' | 'achieved' = 'unconnected';

    if (linkedTargets.length > 0) {
      // northStarRows から該当 label の achievementRate を引く
      const achievements = linkedTargetLabels
        .map((label) => {
          const row = northStarRows.find((r) => r.label === label);
          return row?.achievementRate;
        })
        .filter((a) => a !== undefined) as number[];

      if (achievements.length > 0) {
        resolutionRate = achievements.reduce((s, a) => s + a, 0) / achievements.length;

        // status を決定（resolutionRate に基づく）
        if (resolutionRate >= 100) {
          resolutionStatus = 'achieved';
        } else if (resolutionRate >= 80) {
          resolutionStatus = 'in_progress';
        } else {
          resolutionStatus = 'partial';
        }
      }
    }

    return {
      issueTitle: issue.title,
      issueDescription: issue.description ?? '',
      linkedMetrics: issue.linkedMetrics,
      linkedTargets: linkedTargetLabels,
      resolutionRate,
      resolutionStatus,
    };
  });
}

/**
 * ValueAnalysis カード情報を整形（必要なら）
 */
export function buildValueAnalysisCards(valueAnalysis: any): Array<{
  key: string;
  label: string;
  value: string;
  unit: string;
}> {
  if (!valueAnalysis) return [];

  const cards = [];

  if (valueAnalysis.revenueGrowthRate !== undefined) {
    cards.push({
      key: 'revenueGrowthRate',
      label: '売上CAGR',
      value: valueAnalysis.revenueGrowthRate.toFixed(1),
      unit: '%',
    });
  }

  if (valueAnalysis.operatingMarginRate !== undefined) {
    cards.push({
      key: 'operatingMarginRate',
      label: '営業利益率',
      value: valueAnalysis.operatingMarginRate.toFixed(1),
      unit: '%',
    });
  }

  if (valueAnalysis.roic !== undefined) {
    cards.push({
      key: 'roic',
      label: 'ROIC',
      value: valueAnalysis.roic.toFixed(1),
      unit: '%',
    });
  }

  if (valueAnalysis.wacc !== undefined) {
    cards.push({
      key: 'wacc',
      label: 'WACC',
      value: valueAnalysis.wacc.toFixed(1),
      unit: '%',
    });
  }

  if (valueAnalysis.pbr !== undefined) {
    cards.push({
      key: 'pbr',
      label: 'PBR',
      value: valueAnalysis.pbr.toFixed(1),
      unit: '倍',
    });
  }

  return cards;
}

/* =========================================================
 * Project Contribution 関連（タブ1用）
 * ======================================================= */

/**
 * Unit 正規化（揺れ吸収）
 */
function normalizeUnit(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  if (s === '¥' || s === '円') return 'JPY';
  if (s === '％') return '%';
  if (s.toLowerCase() === 'percent') return 'percent';
  return s;
}

/**
 * KR から YearlyPL を計算（シナリオ適用版）
 */
export function calcYearlyFromKrs(args: {
  baseTraj: BaseTrajectory;
  baseFigures: any;
  krs: BridgeKR[];
  scenario: { successRate: number; synergyRate: number };
  executionWeights?: Map<string, { weight: number }>; // STAGE5 進捗率から計算した weight
}): YearlyPL[] {
  const { baseTraj, baseFigures, krs, scenario, executionWeights } = args;

  const scenarioKrs: BridgeKR[] = krs.map((kr) => {
    const unit = normalizeUnit((kr as any).unit);
    let target = kr.kind === 'SUCCESS_RATE' ? (Number(kr.target) || 0) * scenario.successRate : kr.target;
    const targetBefore = target;

    // プロジェクト固有の executionWeight を適用
    if (kr.projectKey && executionWeights?.has(kr.projectKey)) {
      const weight = executionWeights.get(kr.projectKey)?.weight ?? 1.0;
      target = target * weight;

      // ★ ログ：weight 適用
      console.log('[A] Weight applied:', {
        projectKey: kr.projectKey,
        krLabel: kr.label,
        krKind: kr.kind,
        targetBefore: targetBefore,
        weight,
        targetAfter: target,
      });
    }

    return {
      ...kr,
      target,
      ...(unit ? { unit } : {}),
    };
  });

  if (scenario.synergyRate !== 0) {
    // Stable ID based on scenario values (deterministic)
    const stableHash = Math.abs(
      Math.round(scenario.synergyRate * 10000) +
      Math.round(scenario.successRate * 10000)
    ).toString(36);

    scenarioKrs.push({
      id: `synergy-${stableHash}`,
      kind: 'SYNERGY',
      label: `相乗効果（シナリオ）`,
      target: scenario.synergyRate,
      unit: '%',
      scope: 'company',
      baseKey: 'synergy',
    });
  }

  const bridgeInput: BridgeInput = {
    startYm: baseTraj.startYm,
    endYm: baseTraj.endYm,
    krs: scenarioKrs,
    base: baseFigures,
    config: {
      activityDefault: 'ACQ',
      activityRoute: { 訪問: 'ACQ', 新規: 'ACQ' },
    },
  };

  const deltas = buildBridgeDeltas(bridgeInput);
  const monthly = simulateMonthlyPL(baseTraj, deltas);
  return aggregateYearly(monthly);
}

/**
 * プロジェクト寄与度を計算（タブ1用）
 * core（approved/projectKrsMap/baselineYearly）から寄与度を算出
 */
export function buildProjectContributions(args: {
  core: any; // Stage6Core
  financePL?: any[];
  departments?: any[];
  effectiveSelectedKeys?: string[];
  mkBaseFigures: (state: any) => any;
  mkBaselineTrajectory: (state: any) => BaseTrajectory | null;
  getEvidenceFromProject: (proj: any) => any;
  executionWeightsMap?: Map<string, { weight: number }>; // ★ STAGE5 進捗補正の weight map
}): Array<{
  key: string;
  dept: string;
  proj: string;
  investTotal: number;
  krCount: number;
  deltaRevenueTotal: number;
  deltaOpTotal: number;
  roi?: number;
  evidence?: any;
  executionWeight?: any;
}> {
  const {
    core,
    financePL,
    departments,
    effectiveSelectedKeys,
    mkBaseFigures,
    mkBaselineTrajectory,
    getEvidenceFromProject,
    executionWeightsMap,
  } = args;

  if (!core.ready) return [];

  const baseTraj = mkBaselineTrajectory({ financePL } as any);
  if (!baseTraj) return [];
  const baseFigures = mkBaseFigures({ financePL } as any);

  const baseline = core.baselineYearly;
  const baseScenario = { successRate: 0.8, synergyRate: 0.0 };

  const effectiveSet = new Set(effectiveSelectedKeys || []);

  return core.approved
    .filter((p: any) => effectiveSet.has(p.key))
    .map((p: any) => {
      const krs = core.projectKrsMap.get(p.key) ?? [];

      let deltaRevenueTotal = 0;
      let deltaOpTotal = 0;

      if (krs.length > 0) {
        // プロジェクトキーを付与した KRs を生成
        const krsWithProjectKey = krs.map((kr) => ({
          ...kr,
          projectKey: p.key, // executionWeight 参照用
        }));

        // ★ executionWeightsMap を使用（progressLogs の再計算ではなく）
        const executionWeight = executionWeightsMap?.get(p.key);
        const yearly = calcYearlyFromKrs({
          baseTraj,
          baseFigures,
          krs: krsWithProjectKey,
          scenario: baseScenario,
          executionWeights: executionWeightsMap,
        });

        if (yearly && baseline) {
          // 差分を計算（baseline との比較）
          const delta = diffYearly(baseline, yearly);
          deltaRevenueTotal = sumYearly(delta, 'revenue');
          deltaOpTotal = sumYearly(delta, 'op_income');

          // ★ 詳細ログ：weight が金額に反映されたか確認
          console.log('[STAGE6-weight-to-money]', {
            projectKey: p.key,
            executionWeight: executionWeight?.weight ?? 'none',
            baselineYearlyRevenue: baseline?.[0]?.revenue ?? 0,
            yearlyRevenue: yearly?.[0]?.revenue ?? 0,
            baselineYearlyOpIncome: baseline?.[0]?.op_income ?? 0,
            yearlyOpIncome: yearly?.[0]?.op_income ?? 0,
            deltaRevenueTotal: deltaRevenueTotal.toFixed(2),
            deltaOpTotal: deltaOpTotal.toFixed(2),
          });
        }

        // フォールバック：計算値が0でも、KR がある程度は寄与があるはず
        if ((deltaRevenueTotal === 0 && deltaOpTotal === 0) && krs.length > 0) {
          // 簡易推定：第1KRの target を参考に推定
          const firstKr = krs[0];
          if (firstKr) {
            const parsedTarget = Number(firstKr?.target);
            const targetUnit = (firstKr as any)?.unit;

            if (!Number.isNaN(parsedTarget) && parsedTarget !== 0) {
              const unitNorm = normalizeUnit(targetUnit);

              if (unitNorm === 'JPY') {
                // 売上直接値
                deltaRevenueTotal = Math.max(0, parsedTarget);
                if ((baseline?.[baseline.length - 1]?.revenue ?? 0) > 0) {
                  const opMargin =
                    (baseline[baseline.length - 1]?.op_income ?? 0) /
                    (baseline[baseline.length - 1]?.revenue ?? 1);
                  deltaOpTotal = deltaRevenueTotal * opMargin;
                }
              } else if (unitNorm === '%') {
                // パーセンテージ増（売上成長）
                const yearlyHeadRev = yearly?.[0]?.revenue ?? 0;
                const yearlyHeadOp = yearly?.[0]?.op_income ?? 0;
                const baselineHeadRev = baseline?.[0]?.revenue ?? 0;
                const baselineHeadOp = baseline?.[0]?.op_income ?? 0;

                if (yearlyHeadRev > baselineHeadRev && yearlyHeadOp > baselineHeadOp) {
                  deltaRevenueTotal = yearlyHeadRev - baselineHeadRev;
                  deltaOpTotal = yearlyHeadOp - baselineHeadOp;
                } else if ((baseline?.[baseline.length - 1]?.revenue ?? 0) > 0) {
                  const uplift = Math.min(0.2, (parsedTarget * 0.01) / Math.max(1, Math.abs(parsedTarget)));
                  deltaRevenueTotal = (baseline?.[baseline.length - 1]?.revenue ?? 0) * uplift;
                  const opMargin =
                    (baseline?.[baseline.length - 1]?.op_income ?? 0) /
                    (baseline?.[baseline.length - 1]?.revenue ?? 1);
                  deltaOpTotal = deltaRevenueTotal * opMargin;
                }
              }
            }
          }
        }
      }

      const roi = p.investTotal > 0 ? deltaOpTotal / p.investTotal : undefined;

      // ★ 根拠情報を取得
      let evidence: any = {
        source: 'kr_bridge',
        confidence: 'low',
        notes: 'デフォルト',
      };

      if (Array.isArray(departments)) {
        const deptMatch = departments.find((d: any) => d.name === p.dept);
        if (deptMatch && Array.isArray(deptMatch.projects)) {
          const projMatch = deptMatch.projects.find((proj: any) => proj.title === p.proj);
          if (projMatch) {
            evidence = getEvidenceFromProject(projMatch);
          }
        }
      }

      // ★ 実行度補正係数を取得（executionWeightsMap から）
      const executionWeight = executionWeightsMap?.get(p.key);

      return {
        key: p.key,
        dept: p.dept,
        proj: p.proj,
        investTotal: p.investTotal,
        krCount: p.krCount,
        deltaRevenueTotal,
        deltaOpTotal,
        roi,
        evidence,
        executionWeight,
      };
    });
}
