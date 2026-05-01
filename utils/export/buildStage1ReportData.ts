/**
 * /utils/export/buildStage1ReportData.ts
 *
 * 目的：
 * - STAGE1 現状分析レポート用データの構築
 * - 読み取り専用
 */

import type { StrategyState } from '@/store/strategyStore';

export interface Stage1ReportData {
  companyName: string;
  generatedDate: string;

  // 企業情報
  companyInfo: {
    industry: string;
    revenue: string;
    employees: string;
    businessContent: string;
  };

  // 事業セグメント
  businessSegments: Array<{
    name: string;
  }>;

  // 財務指標
  metrics: {
    revenueGrowth?: string;
    operatingMargin?: string;
    roic?: string;
    wacc?: string;
    pbr?: string;
  };

  // 上場情報
  isListed: boolean;
  ticker?: string;
  pbrManual?: string;

  // ベンチマーク
  benchmarks?: {
    industryMedian?: any;
    competitorA?: any;
    competitorB?: any;
    waccManual?: number;
    waccRationale?: string;
  };

  // 論点
  issueBlocks: Array<{
    title: string;
    description: string;
  }>;
}

/**
 * STAGE1 レポートデータを構築
 */
export function buildStage1ReportData(state: StrategyState): Stage1ReportData {
  const now = new Date();
  const generatedDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return {
    companyName: state.companyName || '（会社名未入力）',
    generatedDate,
    companyInfo: extractCompanyInfo(state),
    businessSegments: extractBusinessSegments(state),
    metrics: extractMetrics(state),
    isListed: (state as any)?.isListed ?? false,
    ticker: (state as any)?.ticker,
    pbrManual: (state as any)?.pbrManual,
    benchmarks: (state as any)?.stage1Benchmarks,
    issueBlocks: extractIssueBlocks(state),
  };
}

/**
 * 企業情報を抽出
 */
function extractCompanyInfo(state: StrategyState): Stage1ReportData['companyInfo'] {
  return {
    industry: state.industry || '（未入力）',
    revenue: state.revenue || '（未入力）',
    employees: state.employees || '（未入力）',
    businessContent: state.businessContent || '（未入力）',
  };
}

/**
 * 事業セグメントを抽出
 */
function extractBusinessSegments(state: StrategyState): Stage1ReportData['businessSegments'] {
  const segments = (state as any)?.businessSegments;
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .filter((seg: any) => seg && seg.name)
    .map((seg: any) => ({
      name: seg.name,
    }));
}

/**
 * 財務指標を抽出
 */
function extractMetrics(state: StrategyState): Stage1ReportData['metrics'] {
  const valueAnalysis = state.valueAnalysis as any;
  if (!valueAnalysis || typeof valueAnalysis !== 'object') {
    return {};
  }

  return {
    revenueGrowth: valueAnalysis.revenueGrowthRate ? `${valueAnalysis.revenueGrowthRate}%` : undefined,
    operatingMargin: valueAnalysis.operatingMarginRate ? `${valueAnalysis.operatingMarginRate}%` : undefined,
    roic: valueAnalysis.roic ? `${valueAnalysis.roic}%` : undefined,
    wacc: valueAnalysis.wacc ? `${valueAnalysis.wacc}%` : undefined,
    pbr: valueAnalysis.pbr ? `${valueAnalysis.pbr}倍` : undefined,
  };
}

/**
 * 論点を抽出
 */
function extractIssueBlocks(state: StrategyState): Stage1ReportData['issueBlocks'] {
  const issues = (state as any)?.stage1Issues;
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .filter((issue: any) => issue && issue.title)
    .map((issue: any) => ({
      title: issue.title || '（未入力）',
      description: issue.description || '（説明未入力）',
    }))
    .slice(0, 10);
}
