/**
 * /utils/export/buildPlanData.ts
 *
 * ステークホルダー別計画書用の共通データ抽出・正規化
 * audience（銀行向け・株主向け・社員向け）で異なるデータをフィルタリング
 *
 * 再利用: buildMidtermPlanData.ts をベースに、audience別フィルタリングを追加
 */

import type { StrategyData, Department, Project } from '@/types/strategy';

export type AudienceType = 'bank' | 'shareholder' | 'employee';

/**
 * ステークホルダー別計画書データの共通型
 * （MidtermPlanData を拡張し、audience別フィールドを追加）
 */
export type PlanData = {
  // 識別情報
  audience: AudienceType;
  companyName?: string;
  companyId?: string;
  strategyId?: string;
  generatedAt?: string;

  // 全社情報
  companyMission?: string;
  companyVision?: string;
  companyValue?: string;
  ceoIntent?: string;

  // STAGE1：現状分析
  stage1: {
    industry?: string;
    employees?: number;
    revenue?: string;
    portfolioPosition?: string;
    mainSegments?: string[];
    keyFinances?: string;
    swotStrengths?: string[];
    swotWeaknesses?: string[];
    swotOpportunities?: string[];
    swotThreats?: string[];
    keyIssues?: string[]; // 論点ブロック

    // ★ Phase 1 追加：過去年度別財務実績
    historicalFinances?: Array<{
      year: number;
      revenue?: number;
      grossProfit?: number;
      operatingIncome?: number;
      netIncome?: number;
      unit?: string; // '百万円', '円' など
      source?: string; // 出典（DB or 計算値）
      warning?: string; // ⚠️ 単位未確認等の警告
    }>;
  };

  // STAGE2：全社戦略
  stage2: {
    finalStory?: string; // 4章ストーリー
    midtermConcept?: string;
    targetVision?: string;
    priorityThemes?: string[];
    growthStrategy?: string;
    profitStrategy?: string;
    portfolioPolicy?: string;
    managementIssues?: string[];
    companyTargets?: Array<{ label: string; value: string }>;
  };

  // STAGE3：事業・部門別戦略
  stage3: {
    departments: Array<{
      name: string;
      currentPosition?: string;
      strategicRole?: string;
      keyIssues?: string[];
      projects?: string[];
      okrs?: string[];
      interDeptCollab?: string[];
      riskNotes?: string[];
      alignmentRisks?: string[];
    }>;
  };

  // STAGE4：KPI・実行計画
  stage4: {
    companyThemes?: string[];
    companyDecisionCriteria?: string[];
    projectImpacts?: Array<{
      title: string;
      impactRevenue?: string;
      impactOpIncome?: string;
      impactInvestment?: string;
      confidence?: number;
    }>;
    departmentKpis?: Array<{
      departmentName: string;
      kpis?: string[];
      risks?: string[];
    }>;
  };

  // STAGE5/6：進捗・シミュレーション
  stage56: {
    // ★ Phase 1 修正：STAGE2目標とSTAGE4施策効果を完全分離
    /** STAGE2に登録された売上目標（確定が必須ではないため参考値） */
    companyTargetRevenue?: string;

    /** STAGE4の施策期待効果合計（参考値、重複未検証） */
    projectImpactSum?: string;

    /** 推奨される目標表示（STAGE2優先、なければ「未設定」） */
    northStarRevenue?: string;

    northStarMetrics?: Array<{ label: string; value: string }>;
    projectionStatus?: 'complete' | 'partial' | 'incomplete';
    projectionNote?: string;
  };

  // 検証結果・不足情報
  validation: {
    hasErrors: boolean;
    hasWarnings: boolean;
    messages: ValidationMessage[];
  };
};

export type ValidationMessage = {
  severity: 'error' | 'warning' | 'info';
  section: string;
  message: string;
  missingFields?: string[];
  recommendation?: string;
};

/**
 * StrategyData から PlanData を構築する
 * audience に応じて異なるフィルタリング・最適化を行う
 */
export function buildPlanData(
  state: Partial<StrategyData> | any,
  audience: AudienceType,
  options?: { companyId?: string; strategyId?: string }
): PlanData {
  const departments = state.departments || [];
  const validation: ValidationMessage[] = [];

  // ===== STAGE1 データ抽出 =====
  // ★ Phase 1 修正：historicalFinances を抽出
  const historicalFinances = extractHistoricalFinances(state);

  const stage1 = {
    industry: (state as any)?.industry || 'N/A',
    employees: (state as any)?.employees,
    revenue: (state as any)?.revenue,
    portfolioPosition: (state as any)?.portfolioPosition,
    mainSegments:
      Array.isArray((state as any)?.businessSegments) &&
      (state as any)?.businessSegments.length > 0
        ? (state as any).businessSegments.slice(0, 5).map((s: any) => s?.name || '')
        : [],
    keyFinances: formatFinancialSummary(state),
    swotStrengths: parseSwotField(state.strength),
    swotWeaknesses: parseSwotField(state.weakness),
    swotOpportunities: parseSwotField(state.opportunity),
    swotThreats: parseSwotField(state.threat),
    keyIssues:
      Array.isArray((state as any)?.stage1Issues) &&
      (state as any)?.stage1Issues.length > 0
        ? (state as any)?.stage1Issues.slice(0, 5).map((issue: any) => issue?.title || '')
        : [],

    // ★ Phase 1 追加：過去年度別財務実績
    historicalFinances: historicalFinances.length > 0 ? historicalFinances : undefined,
  };

  // ===== STAGE2 データ抽出 =====
  const stage2FinalStory =
    Array.isArray(state.finalStory) && state.finalStory.length > 0
      ? state.finalStory.map((ch: any) => `【${ch.title}】${ch.body}`).join('\n\n')
      : undefined;

  const companyTargets = Array.isArray((state as any)?.companyTargets)
    ? (state as any)?.companyTargets
        .slice(0, 5)
        .map((t: any) => ({
          label: t?.label || '',
          value: `${t?.base || ''}${t?.unit || ''}${t?.dueYear ? `（${t.dueYear}年）` : ''}`,
        }))
    : [];

  const midtermStrategy = (state as any)?.midtermStrategy;

  const stage2 = {
    finalStory: stage2FinalStory,
    midtermConcept: midtermStrategy?.midtermConcept,
    targetVision: midtermStrategy?.targetVisionForMidterm,
    priorityThemes: midtermStrategy?.priorityStrategicThemes?.slice(0, 5),
    growthStrategy: midtermStrategy?.growthStrategy,
    profitStrategy: midtermStrategy?.profitImprovementStrategy,
    portfolioPolicy: midtermStrategy?.portfolioPolicy,
    managementIssues: midtermStrategy?.managementMeetingIssues?.slice(0, 5),
    companyTargets,
  };

  // ===== STAGE3 データ抽出 =====
  const stage3Depts = departments
    .slice(0, 10) // 最大10部門まで
    .map((dept: Department) => ({
      name: dept?.name || '(無名)',
      currentPosition: dept?.currentPosition,
      strategicRole: dept?.strategicRole,
      keyIssues: Array.isArray(dept?.keyIssues) ? dept.keyIssues.slice(0, 3) : [],
      projects:
        Array.isArray(dept?.projects) && dept.projects.length > 0
          ? dept.projects
              .slice(0, 5)
              .map((p: Project) => p?.title || '')
              .filter(Boolean)
          : [],
      okrs: extractOkrsFromProjects(dept?.projects),
      interDeptCollab: Array.isArray(dept?.interDeptCollab)
        ? dept.interDeptCollab.slice(0, 3)
        : [],
      riskNotes: Array.isArray(dept?.riskNotes) ? dept.riskNotes.slice(0, 3) : [],
      alignmentRisks: Array.isArray(dept?.alignmentRiskPoints)
        ? dept.alignmentRiskPoints.slice(0, 3)
        : [],
    }));

  const stage3 = {
    departments: stage3Depts,
  };

  // ===== STAGE4 データ抽出 =====
  const projectImpacts: any[] = [];
  departments.forEach((dept: Department) => {
    if (Array.isArray(dept?.projects)) {
      dept.projects.forEach((proj: Project) => {
        projectImpacts.push({
          title: proj?.title,
          impactRevenue: proj?.impactRevenueMJPY
            ? `¥${proj.impactRevenueMJPY}M`
            : undefined,
          impactOpIncome: proj?.impactOpIncomeMJPY
            ? `¥${proj.impactOpIncomeMJPY}M`
            : undefined,
          impactInvestment: proj?.impactInvestmentMJPY
            ? `¥${proj.impactInvestmentMJPY}M`
            : undefined,
          confidence: proj?.impactConfidence,
        });
      });
    }
  });

  const stage4 = {
    companyThemes: stage2.priorityThemes,
    projectImpacts: projectImpacts.slice(0, 20), // 最大20プロジェクト
  };

  // ===== STAGE5/6 データ抽出・検証 =====
  // ★ Phase 1 修正：STAGE2目標とSTAGE4施策効果を完全分離
  const { companyTarget, projectImpact, recommendedTarget } = extractNorthStarRevenue(state, projectImpacts);
  const stage56 = {
    companyTargetRevenue: companyTarget, // STAGE2の正式目標
    projectImpactSum: projectImpact, // STAGE4施策効果合計（参考値）
    northStarRevenue: recommendedTarget, // 推奨表示（STAGE2優先）
    northStarMetrics: extractNorthStarMetrics(state),
    projectionStatus: evaluateProjectionCompleteness(state, audience),
    projectionNote: getProjectionNote(state, audience),
  };

  // ===== 検証メッセージ生成 =====
  const validationMsgs = generateValidationMessages(state, audience);
  validation.push(...validationMsgs);

  const hasErrors = validation.some((m) => m.severity === 'error');
  const hasWarnings = validation.some((m) => m.severity === 'warning');

  return {
    audience,
    companyName: state.companyName,
    companyId: options?.companyId,
    strategyId: options?.strategyId,
    generatedAt: new Date().toISOString(),
    companyMission: state.mission,
    companyVision: state.vision,
    companyValue: state.value,
    ceoIntent: (state as any)?.ceoIntent,
    stage1,
    stage2,
    stage3,
    stage4,
    stage56,
    validation: {
      hasErrors,
      hasWarnings,
      messages: validation,
    },
  };
}

// ===== ユーティリティ関数 =====

/**
 * ★ Phase 1 追加修正：financePL から過去年度別財務実績を抽出
 *
 * ⚠️ 重要：DB保存時の単位が明示されていないため、以下の処理を実施：
 * - 既存システムでは値の大きさで百万円と判定する変換処理がある（strategy.ts L798-820）
 * - しかし金額推定は禁止されているため、単位「未確認」と明示
 * - 正式な財務表への使用は避け、参考情報に留める
 */
function extractHistoricalFinances(state: Partial<StrategyData>): Array<{
  year: number;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  unit?: string;
  source?: string;
  warning?: string;
}> {
  const financePL = (state as any)?.financePL;
  if (!Array.isArray(financePL) || financePL.length === 0) {
    return [];
  }

  // financePL は FinancePLRow[] の形式
  // ⚠️ 注意：DB保存時の単位が type 定義に明示されていない
  return financePL
    .filter((row: any) => row && typeof row.year === 'number')
    .map((row: any) => ({
      year: row.year,
      revenue: typeof row.revenue === 'number' ? row.revenue : undefined,
      grossProfit: typeof row.grossProfit === 'number' ? row.grossProfit : undefined,
      operatingIncome: typeof row.operatingIncome === 'number' ? row.operatingIncome : undefined,
      netIncome: typeof row.netIncome === 'number' ? row.netIncome : undefined,
      unit: '未確認', // DB保存単位が不明
      source: 'STAGE1 入力',
      warning: '⚠️ 保存単位が確定されていません。参考情報に留め、重要な数値判断には使用しないでください。',
    }))
    .sort((a, b) => a.year - b.year);
}

function parseSwotField(field?: string): string[] {
  if (!field || typeof field !== 'string') return [];
  return field
    .split('、')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function formatFinancialSummary(state: Partial<StrategyData>): string {
  const finances = [];
  if ((state as any)?.revenue) finances.push(`売上: ${(state as any).revenue}`);
  if ((state as any)?.valueAnalysis?.operatingMarginPctLatest !== undefined) {
    finances.push(
      `営業利益率: ${((state as any).valueAnalysis.operatingMarginPctLatest * 100).toFixed(1)}%`
    );
  }
  if ((state as any)?.valueAnalysis?.roic !== undefined) {
    finances.push(
      `ROIC: ${((state as any).valueAnalysis.roic * 100).toFixed(1)}%`
    );
  }
  return finances.join(' | ') || 'データなし';
}

function extractOkrsFromProjects(projects?: Project[]): string[] {
  if (!Array.isArray(projects)) return [];
  const okrs: string[] = [];
  projects.forEach((p: any) => {
    if (Array.isArray(p?.okrsV2)) {
      p.okrsV2.forEach((okr: any) => {
        if (okr?.objective) okrs.push(okr.objective);
      });
    }
  });
  return okrs.slice(0, 5);
}

/**
 * ★ Phase 1 最終修正：北極星目標と施策効果を完全分離
 *
 * 基本原則（prompt.txt 指示に従う）：
 * 1. STAGE2の売上目標とSTAGE4の施策別売上寄与合計を、別フィールドで保持する
 * 2. STAGE2に売上目標がない場合、正式な全社売上目標は「未設定」とする
 * 3. STAGE4の合計を northStarRevenue に代入しない
 * 4. STAGE4の単純合計には重複未検証である旨を付記する
 * 5. STAGE2目標を承認済みと断定せず「STAGE2登録目標」と扱う
 */
function extractNorthStarRevenue(
  state: Partial<StrategyData>,
  projectImpacts: any[]
): { companyTarget?: string; projectImpact?: string; recommendedTarget?: string } {
  // ★ Step 1: STAGE2 の正式売上目標を取得（ただし「登録目標」と扱う）
  let companyTarget: string | undefined;
  if (Array.isArray((state as any)?.companyTargets)) {
    const salesTarget = (state as any).companyTargets.find(
      (t: any) => t?.label && (t.label.includes('売上') || t.label.includes('Revenue'))
    );
    if (salesTarget) {
      const baseValue = salesTarget.base;
      const unit = salesTarget.unit || '';
      const dueYear = salesTarget.dueYear ? `（${salesTarget.dueYear}年）` : '';

      if (typeof baseValue === 'number' || (typeof baseValue === 'string' && baseValue.trim() !== '')) {
        companyTarget = `${baseValue}${unit}${dueYear}`;
      }
    }
  }

  // ★ Step 2: STAGE4 施策別期待効果の合計を計算（重複未検証と明記）
  let projectImpact: string | undefined;
  let totalImpact = 0;
  projectImpacts.forEach((p) => {
    const impact = p.impactRevenue?.replace(/[¥M]/g, '');
    if (impact && !isNaN(parseFloat(impact))) {
      totalImpact += parseFloat(impact);
    }
  });

  if (totalImpact > 0) {
    // ★ STAGE4施策効果は「重複未検証」と明記（「参考値」に加えて）
    projectImpact = `¥${totalImpact.toFixed(0)}M（施策別期待効果の単純合計・重複未検証）`;
  }

  // ★ Step 3: 推奨される目標表示（STAGE2優先、なければ「未設定」）
  let recommendedTarget: string | undefined;
  if (companyTarget) {
    // STAGE2目標がある場合、それを推奨
    recommendedTarget = companyTarget;
  } else if (projectImpact) {
    // STAGE2目標がなく、STAGE4効果がある場合、明確に「参考値」と明記
    recommendedTarget = '未設定（STAGE2に正式な売上目標の登録がありません）';
  } else {
    recommendedTarget = '未設定';
  }

  return {
    companyTarget,
    projectImpact,
    recommendedTarget,
  };
}

function extractNorthStarMetrics(
  state: Partial<StrategyData>
): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];

  if (Array.isArray((state as any)?.companyTargets)) {
    (state as any).companyTargets.slice(0, 5).forEach((t: any) => {
      if (t?.label && t?.base) {
        metrics.push({
          label: t.label,
          value: `${t.base}${t.unit || ''}`,
        });
      }
    });
  }

  return metrics;
}

function evaluateProjectionCompleteness(
  state: Partial<StrategyData>,
  audience: AudienceType
): 'complete' | 'partial' | 'incomplete' {
  // STAGE6 データの有無を簡易判定
  const hasStage6 = !!(state as any)?.simulationResult;
  const hasProjection = (state as any)?.financeSummary?.length > 0;

  if (audience === 'bank') {
    // 銀行向け：CF・返済計画が重要
    if (hasProjection) return 'partial';
    return 'incomplete';
  }

  if (audience === 'shareholder') {
    // 株主向け：財務予測が重要
    if (hasStage6 && hasProjection) return 'complete';
    return 'partial';
  }

  // 社員向け：進捗情報が重要
  return hasProjection ? 'partial' : 'incomplete';
}

function getProjectionNote(
  state: Partial<StrategyData>,
  audience: AudienceType
): string {
  const notes: string[] = [];

  if (!((state as any)?.simulationResult)) {
    notes.push('財務シミュレーション: 基本実装段階');
  }

  if (!((state as any)?.financeSummary?.length > 0)) {
    notes.push('財務予測: 準備中');
  }

  if (audience === 'bank') {
    if (!((state as any)?.executionPlanBaseline)) {
      notes.push('月次CF計画: 入力待機中');
    }
    notes.push('返済計画: CFO室にて確認が必要です');
  }

  if (audience === 'employee') {
    if (!((state as any)?.departments?.length > 0)) {
      notes.push('部門別計画: 準備中');
    }
  }

  return notes.join(' | ') || '';
}

function generateValidationMessages(
  state: Partial<StrategyData>,
  audience: AudienceType
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  // 共通：基本情報チェック
  if (!state.companyName) {
    messages.push({
      severity: 'error',
      section: '基本情報',
      message: '会社名が入力されていません',
    });
  }

  // audience別チェック
  if (audience === 'bank') {
    if (!((state as any)?.financeSummary?.length > 0)) {
      messages.push({
        severity: 'warning',
        section: '財務予測',
        message: 'STAGE6の財務シミュレーションはまだ基本実装段階です',
        recommendation:
          '詳細な月次CF・返済計画はCFO室にてご確認ください',
      });
    }
    if (!((state as any)?.executionPlanBaseline)) {
      messages.push({
        severity: 'warning',
        section: '実行計画',
        message: 'STAGE4の実行計画ベースラインがまだ確定していません',
      });
    }
  }

  if (audience === 'shareholder') {
    if (!((state as any)?.midtermStrategy?.portfolioPolicy)) {
      messages.push({
        severity: 'warning',
        section: '経営資源配分',
        message: 'ポートフォリオ方針がまだ入力されていません',
        recommendation: 'CFO室にてご入力ください',
      });
    }
  }

  if (audience === 'employee') {
    if (!((state as any)?.departments?.length > 0)) {
      messages.push({
        severity: 'warning',
        section: '部門別計画',
        message: '部門別戦略がまだ確定していません',
        recommendation: '部門リーダーとの調整が必要です',
      });
    }
  }

  return messages;
}
