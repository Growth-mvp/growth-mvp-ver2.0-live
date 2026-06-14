/**
 * /components/stage2/StrategyStoryPreview.tsx
 *
 * STAGE2 最終ストーリーの戦略書プレビュー
 * 外資系コンサル資料・中期経営計画書のデザインを目指す
 */

import React from 'react';
import type { StoryChapter, MidtermStrategy } from '@/types/strategy';

type FinancialTargetMetric = {
  current: number | null;
  target: number | null;
};

type StrategicAssumptions = {
  external: string[];
  internal: string[];
  implications: string[];
};

type BusinessPortfolioDirection = {
  segmentName: string;
  category: 'core' | 'core_declining' | 'high_margin_rebuild' | 'profit_improvement' | 'growth_investment' | 'redefine' | 'review' | 'explore';
  currentAssessment: string;
  basicDirection: string;
  stage3Question: string;
  source: 'valueAnalysis' | 'segmentPL' | 'businessSegments' | 'businessPortfolio' | 'segmentSpecificFallback' | 'genericFallback';
  metrics?: {
    latestRevenue?: number;
    latestOperatingProfit?: number;
    operatingMarginPct?: number;
    revenueGrowthPct?: number;
    revenueSharePct?: number;
    profitSharePct?: number;
  };
};

interface StrategyStoryPreviewProps {
  story: StoryChapter[];
  finalized: boolean;
  companyName?: string;
  midtermStrategy?: MidtermStrategy;
  financialTargets?: {
    revenue: FinancialTargetMetric;
    operatingProfit: FinancialTargetMetric;
  };
  swotSuggestions?: any;
  swotData?: any;
  businessSegments?: any[];
  segmentPL?: Record<string, any[]>;
  valueAnalysis?: any;
  businessPortfolio?: any;
  mode?: 'screen' | 'pdf'; // ★ 新規：screen=STAGE2画面, pdf=PDFプレビュー用
}

/**
 * 4章に対応した Key Message と右カラムコンテンツ
 */
const CHAPTER_META = [
  {
    id: 'why_change',
    englishLabel: 'Why Change',
    japaneseLabel: '危機認識',
    defaultKeyMessage: '既存市場の延長では、今後の成長機会を取り切れない。',
    strategicImplications: [
      '既存市場依存は、成長鈍化と収益性低下のリスクを高める',
      '将来の成長余地がある市場・顧客・技術領域を見極める必要がある',
      '全社として資源配分を見直す必要がある',
    ],
    nextQuestions: [
      'どの市場を優先するのか',
      'どの事業を伸ばすのか',
      'どの活動を見直すのか',
    ],
    downstreamTargets: [
      '事業・部門別戦略',
      '重点テーマ',
      'KPI設計',
    ],
  },
  {
    id: 'where_to_play',
    englishLabel: 'Where to Play',
    japaneseLabel: '戦略選択',
    defaultKeyMessage: '成長余地のある新市場に経営資源を集中し、収益構造を転換する。',
    strategicImplications: [
      '戦略の本質は、何をやるかだけでなく、何を優先し、何をやめるかを決めること',
      '成長領域への集中投資と、低収益領域の見直しを同時に進める必要がある',
      '既存の強みを活かしながら、将来の収益基盤を再設計する必要がある',
    ],
    nextQuestions: [
      '重点市場はどこか',
      '重点顧客は誰か',
      '重点投資テーマは何か',
      '見直すべき既存事業・業務は何か',
    ],
    downstreamTargets: [
      '事業ポートフォリオ方針',
      '部門別重点テーマ',
      '投資・人材・スキル計画',
    ],
  },
  {
    id: 'what_to_win',
    englishLabel: 'What to Win',
    japaneseLabel: '目指す未来',
    defaultKeyMessage: '顧客から選ばれる専門企業として、新たな収益基盤を確立する。',
    strategicImplications: [
      '目指す未来は、単なる数値目標ではなく、顧客からどのような存在として選ばれるかを明確にすること',
      '顧客価値が明確になることで、部門戦略、KPI、現場行動の判断基準が揃う',
      '売上・利益だけでなく、競争優位と顧客価値を測る指標が必要になる',
    ],
    nextQuestions: [
      '顧客に提供すべき価値は何か',
      '当社が選ばれる理由は何か',
      'どの能力を強化すべきか',
      'どのKPIで未来の成長を測るべきか',
    ],
    downstreamTargets: [
      '顧客価値定義',
      '競争優位の源泉',
      '成長KPI',
    ],
  },
  {
    id: 'how_to_execute',
    englishLabel: 'How to Execute',
    japaneseLabel: '実行設計',
    defaultKeyMessage: '全社戦略を、部門戦略・KPI・実行管理へ具体化する。',
    strategicImplications: [
      'STAGE3で全社戦略を事業別・部門別の重点テーマに展開する',
      'STAGE4で重点テーマをKPI、投資、人員、期限に落とし込む',
      'STAGE5で経営会議を通じて進捗を確認し、戦略と実行のズレを修正する',
    ],
    nextQuestions: [
      'STAGE3で各部門は何を担うのか',
      'STAGE4でどのKPIを設定するのか',
      'STAGE5で進捗をどう確認するのか',
      'どの指標を経営会議で確認すべきか',
    ],
    downstreamTargets: [
      'STAGE3：部門別重点テーマ',
      'STAGE4：KPI・投資・期限の設定',
      'STAGE5：進捗管理と戦略修正',
    ],
  },
];

function stripIssueSummary(text: string): string {
  return text.replace(/【.*?】[\s\S]*?(?=\n\n|$)/g, '').trim();
}

const fallbackStrategicAssumptions: StrategicAssumptions = {
  external: [
    '市場環境や顧客ニーズの変化により、従来の延長だけでは成長機会を十分に取り切れない可能性がある',
    '競争環境の変化に対応するため、成長余地のある市場・顧客・技術領域を見極める必要がある',
    '外部環境の変化を踏まえ、事業機会とリスクを継続的に確認する必要がある',
  ],
  internal: [
    '既存事業で培った顧客基盤・業務知見・組織能力は、今後の成長に向けた重要な資産である',
    '一方で、既存事業や既存業務への依存が、成長領域への資源配分を妨げる可能性がある',
    '全社戦略に基づき、部門・社員の判断基準を揃える必要がある',
  ],
  implications: [
    '既存事業の改善だけでなく、成長領域への資源配分転換と、低収益・非重点領域の見直しを同時に進める必要がある',
  ],
};

function cleanSwotText(text: unknown): string {
  if (!text || typeof text !== 'string') return '';
  // Markdown記号を除去
  let cleaned = String(text)
    .replace(/[*_#\-`【】]/g, ' ')
    .replace(/^[0-9０-９．.、]+[\s　]*/g, '')
    .trim();

  // 複数行の場合は最初の行だけ取る
  const firstLine = cleaned.split(/[\n\n。]/)[0]?.trim() || '';

  // 100文字超えは短縮
  if (firstLine.length > 100) {
    return firstLine.substring(0, 95) + '…';
  }

  return firstLine;
}

function extractSentences(text: unknown): string[] {
  if (!text || typeof text !== 'string') return [];
  const cleaned = String(text)
    .replace(/[*_#\-`【】\d０-９．.、]/g, ' ')
    .trim();

  // 句読点で分割
  const sentences = cleaned
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s.length < 100);

  return sentences;
}

function buildStrategicAssumptions(input: {
  swotSuggestions?: any;
  swotData?: any;
  story?: string;
  midtermStrategy?: any;
}): StrategicAssumptions {
  const result: StrategicAssumptions = {
    external: [],
    internal: [],
    implications: [],
  };

  const seen = new Set<string>();

  // Opportunity/Threatから外部環境を抽出
  const externalCandidates: string[] = [];

  if (input.swotSuggestions?.opportunity && Array.isArray(input.swotSuggestions.opportunity)) {
    input.swotSuggestions.opportunity.forEach((o: any) => {
      const cleaned = cleanSwotText(o);
      if (cleaned && !seen.has(cleaned)) {
        externalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  if (input.swotData?.opportunities && Array.isArray(input.swotData.opportunities)) {
    input.swotData.opportunities.forEach((o: any) => {
      const cleaned = cleanSwotText(o);
      if (cleaned && !seen.has(cleaned)) {
        externalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  // Threatを追加
  if (input.swotSuggestions?.threat && Array.isArray(input.swotSuggestions.threat)) {
    input.swotSuggestions.threat.forEach((t: any) => {
      const cleaned = cleanSwotText(t);
      if (cleaned && !seen.has(cleaned)) {
        externalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  if (input.swotData?.threats && Array.isArray(input.swotData.threats)) {
    input.swotData.threats.forEach((t: any) => {
      const cleaned = cleanSwotText(t);
      if (cleaned && !seen.has(cleaned)) {
        externalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  result.external = externalCandidates.slice(0, 3);

  // Strength/Weaknessから内部環境を抽出
  const internalCandidates: string[] = [];

  if (input.swotSuggestions?.strength && Array.isArray(input.swotSuggestions.strength)) {
    input.swotSuggestions.strength.forEach((s: any) => {
      const cleaned = cleanSwotText(s);
      if (cleaned && !seen.has(cleaned)) {
        internalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  if (input.swotData?.strengths && Array.isArray(input.swotData.strengths)) {
    input.swotData.strengths.forEach((s: any) => {
      const cleaned = cleanSwotText(s);
      if (cleaned && !seen.has(cleaned)) {
        internalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  // Weaknessを追加
  if (input.swotSuggestions?.weakness && Array.isArray(input.swotSuggestions.weakness)) {
    input.swotSuggestions.weakness.forEach((w: any) => {
      const cleaned = cleanSwotText(w);
      if (cleaned && !seen.has(cleaned)) {
        internalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  if (input.swotData?.weaknesses && Array.isArray(input.swotData.weaknesses)) {
    input.swotData.weaknesses.forEach((w: any) => {
      const cleaned = cleanSwotText(w);
      if (cleaned && !seen.has(cleaned)) {
        internalCandidates.push(cleaned);
        seen.add(cleaned);
      }
    });
  }

  result.internal = internalCandidates.slice(0, 3);

  // implications: midtermStrategyから、またはfallback
  if (input.midtermStrategy?.growthStrategy) {
    const impl = cleanSwotText(input.midtermStrategy.growthStrategy);
    if (impl) {
      result.implications.push(impl);
    }
  }

  // 不足分はfallbackで補完
  if (result.external.length === 0) {
    result.external = fallbackStrategicAssumptions.external;
  } else if (result.external.length < 3) {
    result.external.push(
      ...fallbackStrategicAssumptions.external.slice(0, 3 - result.external.length)
    );
  }

  if (result.internal.length === 0) {
    result.internal = fallbackStrategicAssumptions.internal;
  } else if (result.internal.length < 3) {
    result.internal.push(
      ...fallbackStrategicAssumptions.internal.slice(0, 3 - result.internal.length)
    );
  }

  if (result.implications.length === 0) {
    result.implications = fallbackStrategicAssumptions.implications;
  } else if (result.implications.length > 2) {
    result.implications = result.implications.slice(0, 2);
  }

  return result;
}

function renderParagraphs(text: string, variant: 'screen' | 'pdf' = 'screen') {
  const cleaned = stripIssueSummary(text ?? '');
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  const paragraphClass = variant === 'pdf'
    ? 'whitespace-pre-wrap break-words text-justify text-[11px] leading-[1.65] tracking-[0.001em] text-slate-700'
    : 'whitespace-pre-wrap break-words text-justify leading-8 tracking-[0.005em] text-slate-700';

  return paragraphs.map((p, i) => (
    <p key={i} className={paragraphClass}>
      {p}
    </p>
  ));
}

const portfolioDirectionLabels: Record<BusinessPortfolioDirection['category'], string> = {
  core: '既存主力事業',
  core_declining: '成長が必要な主力事業',
  high_margin_rebuild: '再成長が必要な高収益事業',
  profit_improvement: '収益改善事業',
  growth_investment: '重点成長投資事業',
  redefine: '再定義事業',
  review: '見直し対象領域',
  explore: '探索・新規領域',
};

const segmentSpecificFallbacks: Record<string, {
  assessment: string;
  direction: string;
  stage3: string;
}> = {
  'エンバイロメント事業': {
    assessment:
      '自動車排ガス浄化用セラミックスなどを中心とする既存収益基盤である一方、EVシフトにより中長期的な市場構造変化の影響を受ける可能性がある',
    direction:
      '既存収益を維持しながら、環境対応・脱炭素・新興市場向けの用途展開を進め、既存市場依存を段階的に抑制する',
    stage3: 'EVシフト影響の見極め、既存顧客依存の見直し、新興市場での用途開拓、収益性維持KPI',
  },
  'デジタルソサエティ事業': {
    assessment:
      'デジタル化・半導体・情報通信領域の需要拡大を取り込める成長候補領域であり、技術開発と顧客開拓の強化が必要である',
    direction:
      '重点成長領域として、製品開発・顧客接点・パートナー連携に経営資源を配分し、次の収益基盤として育成する',
    stage3: '重点顧客の選定、開発テーマの優先順位、投資回収KPI、技術優位性の事業化',
  },
  'エネルギー＆インダストリー事業': {
    assessment:
      '脱炭素、エネルギー転換、産業インフラ更新により中長期の成長機会がある一方、事業化までの時間軸と投資判断が重要である',
    direction:
      '中長期の成長候補として、技術開発と市場検証を進め、収益化可能なテーマへ投資を集中する',
    stage3: '市場選定、技術優位性、事業化ロードマップ、投資判断基準、パートナー戦略',
  },
};

/**
 * segmentPL から事業別財務指標を計算
 */
function buildSegmentMetricsFromPL(
  segmentName: string,
  segmentPLArray: any[],
  allSegmentPLs: Record<string, any[]>
): BusinessPortfolioDirection['metrics'] | null {
  if (!Array.isArray(segmentPLArray) || segmentPLArray.length === 0) {
    return null;
  }

  // ★ 年度フィールドを特定
  const getYear = (row: any): number => {
    const year = row.year ?? row.fiscalYear ?? row.period ?? row.年度 ?? 0;
    return Number(year) || 0;
  };

  // ★ 売上フィールドを特定
  const getRevenue = (row: any): number => {
    const rev = row.revenue ?? row.sales ?? row.netSales ?? row.売上 ?? row.売上高 ?? 0;
    return Number(rev) || 0;
  };

  // ★ 営業利益フィールドを特定
  const getOperatingProfit = (row: any): number => {
    const profit = row.operatingProfit ?? row.operatingIncome ?? row.operating_profit ?? row.営業利益 ?? 0;
    return Number(profit) || 0;
  };

  // 最新年度と最古年度を判定
  const sortedRows = [...segmentPLArray].sort((a, b) => getYear(b) - getYear(a));
  const latestRow = sortedRows[0];
  const oldestRow = sortedRows[sortedRows.length - 1];

  if (!latestRow) return null;

  const latestRevenue = getRevenue(latestRow);
  const latestOperatingProfit = getOperatingProfit(latestRow);
  const oldestRevenue = getRevenue(oldestRow);

  // 営業利益率
  const operatingMarginPct = latestRevenue > 0 ? (latestOperatingProfit / latestRevenue) * 100 : 0;

  // 売上成長率
  const revenueGrowthPct = oldestRevenue > 0 ? ((latestRevenue - oldestRevenue) / oldestRevenue) * 100 : 0;

  // ★ 全事業の最新年度合計を計算（構成比用）
  let totalLatestRevenue = 0;
  let totalLatestOperatingProfit = 0;
  for (const [_, plArray] of Object.entries(allSegmentPLs)) {
    if (Array.isArray(plArray) && plArray.length > 0) {
      const sorted = [...plArray].sort((a, b) => getYear(b) - getYear(a));
      totalLatestRevenue += getRevenue(sorted[0]);
      totalLatestOperatingProfit += getOperatingProfit(sorted[0]);
    }
  }

  const revenueSharePct = totalLatestRevenue > 0 ? (latestRevenue / totalLatestRevenue) * 100 : 0;
  const profitSharePct = totalLatestOperatingProfit > 0 ? (latestOperatingProfit / totalLatestOperatingProfit) * 100 : 0;

  return {
    latestRevenue,
    latestOperatingProfit,
    operatingMarginPct: Math.round(operatingMarginPct * 10) / 10,
    revenueGrowthPct: Math.round(revenueGrowthPct * 10) / 10,
    revenueSharePct: Math.round(revenueSharePct * 10) / 10,
    profitSharePct: Math.round(profitSharePct * 10) / 10,
  };
}

function buildBusinessPortfolioDirections(input: {
  businessSegments?: any[];
  segmentPL?: Record<string, any[]>;
  valueAnalysis?: any;
  businessPortfolio?: any;
}): BusinessPortfolioDirection[] {
  if (!input.businessSegments || input.businessSegments.length === 0) {
    return [];
  }

  const getNumber = (obj: any, keys: string[]): number | null => {
    for (const key of keys) {
      const val = obj?.[key];
      if (val != null) {
        const num = Number(val);
        if (!isNaN(num)) return num;
      }
    }
    return null;
  };

  const classifySegment = (segment: any): BusinessPortfolioDirection['category'] => {
    const revenueShare = getNumber(segment, ['revenueShare', 'revenueAvgPct', 'salesShare', 'revenuePct', 'salesPct']);
    const profitMargin = getNumber(segment, ['profitMargin', 'operatingMarginPctLatest', 'operatingMargin', 'margin', 'operatingMarginPct']);
    const growthRate = getNumber(segment, ['growthRate', 'revenueGrowthPctLatest', 'revenueGrowthRate', 'salesGrowthRate', 'growth']);

    if ((growthRate ?? 0) >= 5 && (profitMargin ?? 0) >= 10) return 'growth_investment';
    if ((revenueShare ?? 0) >= 30 && (profitMargin ?? 0) >= 10) return 'core';
    if ((revenueShare ?? 0) >= 30 && (profitMargin ?? 0) < 10) return 'profit_improvement';
    if ((growthRate ?? 0) < 0 && (profitMargin ?? 0) < 5) return 'review';
    if ((revenueShare ?? 0) > 0 && (growthRate ?? 0) > 0 && (profitMargin ?? 0) > 0) return 'explore';
    return 'core';
  };

  const classifySegmentFromMetrics = (metrics: BusinessPortfolioDirection['metrics']): BusinessPortfolioDirection['category'] => {
    const { revenueSharePct = 0, operatingMarginPct = 0, revenueGrowthPct = 0, profitSharePct = 0 } = metrics || {};

    // より細かい判定ロジック：優先順位高い順
    // 1. 売上構成比が高く、成長率がマイナスの場合
    if ((revenueSharePct ?? 0) >= 30 && (revenueGrowthPct ?? 0) < 0) {
      return 'core_declining';
    }

    // 2. 利益率が高いが、成長率がマイナスの場合
    if ((operatingMarginPct ?? 0) >= 10 && (revenueGrowthPct ?? 0) < 0) {
      return 'high_margin_rebuild';
    }

    // 3. 一定規模があるが、利益率が低い場合
    if ((revenueSharePct ?? 0) >= 20 && (operatingMarginPct ?? 0) < 10) {
      return 'profit_improvement';
    }

    // 4. 成長率がプラスで利益率も高い場合
    if ((revenueGrowthPct ?? 0) > 0 && (operatingMarginPct ?? 0) >= 10) {
      return 'growth_investment';
    }

    // フォールバック
    if ((revenueSharePct ?? 0) >= 30) return 'core';
    if ((revenueGrowthPct ?? 0) >= 5) return 'growth_investment';
    return 'core';
  };

  const directionByCategory: Record<BusinessPortfolioDirection['category'], {
    assessment: string;
    direction: string;
    stage3: string;
  }> = {
    core: {
      assessment: '売上・利益への貢献が大きい現在の収益基盤',
      direction: '収益性を維持しながら、成長領域への横展開を進める',
      stage3: '既存収益の維持、顧客基盤の活用、隣接領域への展開',
    },
    core_declining: {
      assessment: '売上構成比が高い現在の主力事業だが、成長率がマイナスであり、既存用途の成長鈍化リスクがある',
      direction: '既存収益を維持しながら、新用途・新市場への展開により依存度を下げる',
      stage3: '収益性維持、既存顧客依存の見直し、新用途開拓、縮小リスク対応',
    },
    high_margin_rebuild: {
      assessment: '高い収益性を持つ一方、成長率がマイナスであり、成長回復が課題である',
      direction: '高付加価値領域として維持・強化し、重点顧客・用途開発・パートナー連携により再成長を図る',
      stage3: '重点顧客、開発テーマ、成長回復KPI、投資回収基準',
    },
    profit_improvement: {
      assessment: '一定の売上規模はあるが、営業利益率が低く、収益性改善が必要である',
      direction: '価格、原価、業務効率、提供価値を見直し、利益率改善を優先する',
      stage3: '利益率改善KPI、コスト構造、提供価値、業務改革',
    },
    growth_investment: {
      assessment: '成長性・収益性がともに高く、重点投資候補である',
      direction: '投資・人材・開発リソースを重点配分し、次の収益基盤として育成する',
      stage3: '重点顧客、開発テーマ、投資回収KPI、パートナー戦略',
    },
    review: {
      assessment: '成長性・収益性が限定的で、継続意義を見直すべき領域',
      direction: '改善、縮小、再編、撤退を含めて資源配分を見直す',
      stage3: '継続判断基準、撤退基準、資源再配分',
    },
    explore: {
      assessment: '事業の位置づけを再定義し、成長性・収益性を見極めるべき領域',
      direction: '市場性、顧客価値、技術優位性を確認し、重点化の可否を判断する',
      stage3: '市場選定、顧客価値、競争優位、投資判断',
    },
    redefine: {
      assessment: '事業の位置づけを再定義し、成長性・収益性を見極めるべき領域',
      direction: '市場性、顧客価値、技術優位性を確認し、重点化の可否を判断する',
      stage3: '市場選定、顧客価値、競争優位、投資判断',
    },
  };

  return input.businessSegments.map((segment: any) => {
    const name = segment.name || segment.segmentName || segment.businessName || '事業';

    // 優先順位：
    // 1. valueAnalysis 内の事業別分析データ
    // 2. businessSegments の事業別数値から簡易判定
    // 3. 事業名別 fallback
    // 4. 汎用 fallback

    let category: BusinessPortfolioDirection['category'];
    let currentAssessment: string;
    let basicDirection: string;
    let stage3Question: string;
    let source: BusinessPortfolioDirection['source'];
    let metrics: BusinessPortfolioDirection['metrics'] | undefined;

    // 優先順位：
    // 1. valueAnalysis 内の事業別分析データ
    // 2. segmentPL から計算した事業別財務指標
    // 3. businessSegments の事業別数値から簡易判定
    // 4. businessPortfolio がある場合
    // 5. 事業名別 fallback
    // 6. 汎用 fallback

    const valueAnalysisData = input.valueAnalysis?.[name];

    // 1. valueAnalysis から事業別分析データを取得できるか確認
    if (valueAnalysisData && (valueAnalysisData.currentStatus || valueAnalysisData.basicDirection || valueAnalysisData.stage3Focus)) {
      category = valueAnalysisData.direction || classifySegment(segment);
      currentAssessment = valueAnalysisData.currentStatus;
      basicDirection = valueAnalysisData.basicDirection;
      stage3Question = valueAnalysisData.stage3Focus;
      source = 'valueAnalysis';
    }
    // 2. segmentPL から財務指標を計算
    else if (input.segmentPL && input.segmentPL[name]) {
      const plMetrics = buildSegmentMetricsFromPL(name, input.segmentPL[name], input.segmentPL);
      if (plMetrics) {
        metrics = plMetrics;
        // ★ メトリクスをもとに分類する簡易関数を作成
        category = classifySegmentFromMetrics(plMetrics);
        const examples = directionByCategory[category];
        currentAssessment = examples.assessment;
        basicDirection = examples.direction;
        stage3Question = examples.stage3;
        source = 'segmentPL';
      } else {
        // フォールスルー：3へ
        category = classifySegment(segment);
        const examples = directionByCategory[category];
        currentAssessment = examples.assessment;
        basicDirection = examples.direction;
        stage3Question = examples.stage3;
        source = 'businessSegments';
      }
    }
    // 3. businessSegments からの分類
    else {
      category = classifySegment(segment);
      const examples = directionByCategory[category];
      currentAssessment = examples.assessment;
      basicDirection = examples.direction;
      stage3Question = examples.stage3;

      // businessSegments に数値があるかをチェック
      const hasMetrics = segment.revenueShare !== undefined || segment.revenueAvgPct !== undefined ||
                        segment.profitMargin !== undefined || segment.operatingMarginPctLatest !== undefined ||
                        segment.growthRate !== undefined || segment.revenueGrowthPctLatest !== undefined ||
                        segment.salesShare !== undefined || segment.operatingMargin !== undefined ||
                        segment.margin !== undefined;

      if (hasMetrics) {
        source = 'businessSegments';
      } else {
        // 4. businessPortfolio がある場合
        const portfolioData = input.businessPortfolio?.[name];
        if (portfolioData) {
          source = 'businessPortfolio';
        }
        // 5. 事業名別 fallback
        else {
          const segmentSpecific = segmentSpecificFallbacks[name];
          if (segmentSpecific) {
            source = 'segmentSpecificFallback';
          }
          // 6. 汎用 fallback
          else {
            source = 'genericFallback';
          }
        }
      }
    }

    const result: BusinessPortfolioDirection = {
      segmentName: name,
      category,
      currentAssessment,
      basicDirection,
      stage3Question,
      source,
    };

    if (metrics) {
      result.metrics = metrics;
    }

    return result;
  });
}




function cleanChapterTitle(rawTitle: string | undefined, chapterNumber: number): string {
  const fallbackTitles = [
    'なぜ今、変わる必要があるのか',
    'どこで戦うのか',
    'どんな未来を実現するのか',
    '社員一人ひとりはどう行動するのか',
  ];

  let title = (rawTitle ?? '').trim();
  if (!title) return fallbackTitles[chapterNumber - 1] ?? `章タイトル未設定`;

  // Markdownの見出しを削除（## なぜ今 のような形式）
  title = title.replace(/^#+\s*/, '').trim();

  // 数字の全半角揺れに対応した章番号除去
  // 対応パターン：第1章、第１章、1章、１章、Chapter1 など
  const chapterPrefixPatterns = [
    /^第\s*[0-9０-９一二三四五六七八九十]+\s*章\s*[：:・\-—–\s]*/,
    /^[0-9０-９一二三四五六七八九十]+\s*章\s*[：:・\-—–\s]*/,
    /^chapter\s*[0-9０-９一二三四五六七八九十]+\s*[：:・\-—–\s]*/i,
  ];

  for (const pattern of chapterPrefixPatterns) {
    while (pattern.test(title)) {
      title = title.replace(pattern, '').trim();
    }
  }

  return title || fallbackTitles[chapterNumber - 1] || `章タイトル未設定`;
}

function safeRatio(current: number | null | undefined, target: number | null | undefined): number | null {
  if (current == null || target == null || !Number.isFinite(current) || !Number.isFinite(target) || target === 0) {
    return null;
  }
  return current / target;
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatOkuFromMillion(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const oku = value / 100;
  return `${Math.round(oku).toLocaleString('ja-JP')}億円`;
}

function FinancialTargetMetricCard({
  title,
  current,
  target,
}: {
  title: string;
  current: number | null;
  target: number | null;
}) {
  const achievementRate = safeRatio(current, target);
  const progressPct = achievementRate == null ? 0 : Math.min(Math.max(achievementRate * 100, 0), 100);
  const delta = current != null && target != null ? target - current : null;
  const deltaIsPositive = delta == null || delta >= 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Target KPI</p>
          <h5 className="mt-1 text-base font-bold text-slate-950">{title}</h5>
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          達成率 {achievementRate != null ? formatPct(achievementRate) : '—'}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-500">現状</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{formatOkuFromMillion(current)}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {current != null ? `${Math.round(current).toLocaleString('ja-JP')}百万円` : '—'}
          </p>
        </div>
        <div className="rounded-xl bg-slate-100 p-4">
          <p className="text-xs font-semibold text-slate-700">目標</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{formatOkuFromMillion(target)}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {target != null ? `${Math.round(target).toLocaleString('ja-JP')}百万円` : '—'}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>現状から目標への進捗</span>
          <span>{achievementRate != null ? formatPct(achievementRate) : '—'}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-slate-900 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
        <span className="font-medium text-slate-500">必要な上積み</span>
        <span className={`font-bold ${deltaIsPositive ? 'text-emerald-700' : 'text-red-600'}`}>
          {delta != null ? `${delta >= 0 ? '+' : ''}${formatOkuFromMillion(delta)}` : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * 数値目標と達成ギャップ
 * 結論直後に配置し、戦略の説得力を数値で補強する。
 */
function FinancialTargetGapPanel({
  revenue,
  operatingProfit,
}: {
  revenue: FinancialTargetMetric;
  operatingProfit: FinancialTargetMetric;
}) {
  const hasAny = [revenue.current, revenue.target, operatingProfit.current, operatingProfit.target].some(
    (v) => v != null && Number.isFinite(v)
  );

  if (!hasAny) return null;

  return (
    <section className="mb-12 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="mb-4 flex flex-col gap-1.5 border-b border-slate-100 pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-700">Financial Target</p>
        <h3 className="text-xl font-bold text-slate-950">数値目標と達成ギャップ</h3>
        <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
          この戦略により、売上・営業利益の成長目標を実現し、持続的な収益基盤への転換を目指します。
          現在値と目標値の差分を明確にし、STAGE3以降の部門戦略・KPI設計に接続します。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <FinancialTargetMetricCard title="売上" current={revenue.current} target={revenue.target} />
        <FinancialTargetMetricCard title="営業利益" current={operatingProfit.current} target={operatingProfit.target} />
      </div>
    </section>
  );
}

/**
 * 結論ボックス（白背景 + 左ネイビー罫線）
 */
function ConclusionBox() {
  return (
    <div className="mb-10 rounded-[24px] border border-slate-200 border-l-4 border-l-slate-800 bg-white/95 p-8 shadow-sm">
      <h3 className="text-lg font-bold text-slate-950 mb-4">
        この戦略ストーリーの結論
      </h3>
      <div className="space-y-4 text-sm leading-relaxed text-slate-700">
        <p>
          当社は、既存市場・既存事業の延長だけでは、今後の成長機会を十分に取り切ることが難しい局面にある。
          今後は、環境変化によって生まれる新たな成長領域へ経営資源を重点配分し、既存事業依存からの脱却と収益構造の転換を進める。
        </p>
        <p>
          そのために、全社として「どの市場で戦うのか」「何に投資するのか」「何を優先し、何を見直すのか」という判断基準を明確にし、
          部門・社員一人ひとりの判断と行動を成長領域に揃えていく。
        </p>
      </div>
    </div>
  );
}

/**
 * 戦略判断の前提ブロック
 */
function StrategicAssumptionBlock({
  assumptions,
}: {
  assumptions: StrategicAssumptions;
}) {
  return (
    <section className="mb-12 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="mb-4 flex flex-col gap-1.5 border-b border-slate-100 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700">Strategic Assumptions</p>
        <h3 className="text-xl font-bold text-slate-950">戦略判断の前提</h3>
        <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
          外部環境と内部環境の要点
        </p>
      </div>

      <div className="space-y-6">
        {/* 外部環境 */}
        <div>
          <h4 className="text-sm font-bold text-slate-900 mb-3">外部環境</h4>
          <ul className="space-y-2">
            {assumptions.external.map((item, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-slate-700 leading-relaxed">
                <span className="shrink-0 text-slate-400 mt-0.5">・</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 内部環境 */}
        <div className="border-t border-slate-100 pt-6">
          <h4 className="text-sm font-bold text-slate-900 mb-3">内部環境</h4>
          <ul className="space-y-2">
            {assumptions.internal.map((item, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-slate-700 leading-relaxed">
                <span className="shrink-0 text-slate-400 mt-0.5">・</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 戦略上の含意 */}
        <div className="border-t border-slate-100 pt-6">
          <h4 className="text-sm font-bold text-slate-900 mb-3">戦略上の含意</h4>
          <div className="space-y-2">
            {assumptions.implications.map((item, idx) => (
              <p key={idx} className="text-sm text-slate-700 leading-relaxed">
                {item}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * 戦略ストーリーの全体像（4カード）
 */
function StoryFlowCards() {
  return (
    <div className="mb-12">
      <h3 className="text-lg font-bold text-slate-950 mb-1">
        戦略ストーリーの全体像
      </h3>
      <p className="text-sm text-slate-500 mb-6">
        全社戦略の4つの柱：危機認識→戦略選択→目指す未来→行動指針
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {CHAPTER_META.map((ch, idx) => (
          <div
            key={ch.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-center mb-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                {String(idx + 1).padStart(2, '0')}
              </span>
            </div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-1">
              {ch.englishLabel}
            </p>
            <h4 className="text-base font-bold text-slate-950 mb-3">
              {ch.japaneseLabel}
            </h4>
            <p className="text-sm leading-relaxed text-slate-600">
              {ch.id === 'why_change' && '既存市場の延長では、今後の成長機会を取り切れない。'}
              {ch.id === 'where_to_play' && '成長余地のある市場・顧客・技術領域に経営資源を集中する。'}
              {ch.id === 'what_to_win' && '顧客から選ばれる専門企業として、新たな収益基盤を確立する。'}
              {ch.id === 'how_to_execute' && '全社戦略を、部門戦略・KPI・実行管理へ具体化する。'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 中計設計ブロック（Insight Panel）
 */
function MidtermDesignBox({
  midtermStrategy,
  businessSegments,
  valueAnalysis,
  businessPortfolioDirections,
}: {
  midtermStrategy?: MidtermStrategy;
  businessSegments?: any[];
  valueAnalysis?: any;
  businessPortfolioDirections?: any[];
}) {
  if (!midtermStrategy) return null;

  const hasAny = Object.values(midtermStrategy).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim()
  );

  if (!hasAny) return null;

  // businessPortfolioDirections が渡されている場合はそれを使用、それ以外は再計算
  const portfolioDirections = businessPortfolioDirections ?? buildBusinessPortfolioDirections({
    businessSegments,
    valueAnalysis,
  });

  return (
    <div className="mb-12 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-8 shadow-sm">
      <p className="text-[10px] font-bold tracking-[0.18em] text-slate-700 uppercase mb-2">
        Strategic Deployment Axis
      </p>
      <h3 className="mb-2 text-[22px] font-bold leading-snug text-slate-950">
        中計設計：全社戦略の展開軸
      </h3>
      <p className="text-sm text-slate-700 mb-6">
        この中期経営計画は、単なる方針文書ではなく、STAGE3以降の事業・部門別戦略、STAGE4の実行計画・KPI、STAGE5の実行管理へ展開するための判断基準として活用します。
      </p>
      <div className="space-y-4 text-sm">
        {midtermStrategy.midtermConcept && (
          <div>
            <span className="font-bold text-slate-900">1. 中計の基本コンセプト：</span>
            <span className="text-slate-700 ml-2">{midtermStrategy.midtermConcept}</span>
          </div>
        )}
        {midtermStrategy.targetVisionForMidterm && (
          <div>
            <span className="font-bold text-slate-900">2. 目指す姿：</span>
            <span className="text-slate-700 ml-2">{midtermStrategy.targetVisionForMidterm}</span>
          </div>
        )}
        {midtermStrategy.priorityStrategicThemes?.length ? (
          <div>
            <span className="font-bold text-slate-900">3. 重点戦略テーマ：</span>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-slate-700">
              {midtermStrategy.priorityStrategicThemes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 事業ポートフォリオの基本方針 */}
        <div className="border-t border-slate-200 pt-4 mt-4">
          <span className="font-bold text-slate-900">4. 事業ポートフォリオの基本方針：</span>
          <p className="text-slate-600 mt-2 mb-4">
            各事業の現在位置と、全社戦略上の大まかな方向性を整理します。
          </p>
          {portfolioDirections.length > 0 ? (
            <div className="space-y-3 ml-4">
              {portfolioDirections.map((pd, idx) => {
                const segment = businessSegments?.find(s => (s.name || s.segmentName || s.businessName) === pd.segmentName);
                let sourceLabel = '';

                if (pd.source === 'valueAnalysis') {
                  sourceLabel = 'STAGE1 ValueAnalysisに基づく';
                } else if (pd.source === 'segmentPL' && pd.metrics) {
                  const { revenueSharePct, operatingMarginPct, revenueGrowthPct } = pd.metrics;
                  sourceLabel = `STAGE1事業別P/Lに基づく（売上構成比 ${revenueSharePct?.toFixed(1)}%、営業利益率 ${operatingMarginPct?.toFixed(1)}%、売上成長率 ${revenueGrowthPct?.toFixed(1)}%）`;
                } else if (pd.source === 'businessSegments') {
                  sourceLabel = `STAGE1財務データに基づく（売上構成比 ${segment?.revenueShare ?? segment?.salesShare ?? '-'}%、営業利益率 ${segment?.profitMargin ?? segment?.operatingMargin ?? segment?.margin ?? '-'}%、成長率 ${segment?.growthRate ?? segment?.revenueGrowthRate ?? segment?.salesGrowthRate ?? '-'}%）`;
                } else if (pd.source === 'segmentSpecificFallback') {
                  sourceLabel = '事業名に基づく暫定方針';
                } else if (pd.source === 'genericFallback') {
                  sourceLabel = '汎用方針';
                } else {
                  sourceLabel = '分析根拠未取得';
                }

                const categoryLabel = portfolioDirectionLabels[pd.category as BusinessPortfolioDirection['category']];

                return (
                  <div key={idx} className="border-l-2 border-slate-300 pl-4 py-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-800">{pd.segmentName}</p>
                      {categoryLabel && (
                        <span className="text-[10px] px-2 py-1 rounded bg-slate-100 text-slate-700">
                          {categoryLabel}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">現状評価：{pd.currentAssessment}</p>
                    <p className="text-xs text-slate-600 mt-1">基本方向性：{pd.basicDirection}</p>
                    <p className="text-xs text-slate-600 mt-1">STAGE3での展開論点：{pd.stage3Question}</p>
                    <p className="text-[10px] text-slate-500 mt-2 italic">
                      分析根拠：{sourceLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ml-4 space-y-3 text-slate-700">
              <p className="text-xs">既存主力事業：現在の収益基盤として維持しつつ、成長余地と収益性を見極め、過度な依存を抑制する。</p>
              <p className="text-xs">成長候補事業：市場成長性・収益性が見込まれる領域として、投資・人材・開発リソースを重点配分する。</p>
              <p className="text-xs">収益改善事業：一定の売上規模はあるが収益性に課題がある領域について、価格、原価、業務効率、提供価値の見直しを進める。</p>
              <p className="text-xs">見直し対象領域：成長性・収益性・戦略的重要性が限定的な場合、縮小・再編・撤退を含めて検討する。</p>
            </div>
          )}
        </div>

        {midtermStrategy.companyWideDecisionCriteria?.length ? (
          <div className="border-t border-slate-200 pt-4 mt-4">
            <span className="font-bold text-slate-900">5. 全社共通の判断基準：</span>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-slate-700">
              {midtermStrategy.companyWideDecisionCriteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {midtermStrategy.deploymentPrinciplesForUnits?.length ? (
          <div className="border-t border-slate-200 pt-4 mt-4">
            <span className="font-bold text-slate-900">6. 部門・社員への展開方針：</span>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-slate-700">
              {midtermStrategy.deploymentPrinciplesForUnits.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-600">
        この全社戦略の判断軸は、STAGE3の事業・部門別戦略に展開されます。
      </p>
    </div>
  );
}


/**
 * 重点戦略と優先順位（PDF用）
 * midtermStrategy が薄い場合は、事業ポートフォリオ方向性から補完する。
 */
function StrategicThemePanel({
  midtermStrategy,
  businessPortfolioDirections,
}: {
  midtermStrategy?: MidtermStrategy;
  businessPortfolioDirections?: BusinessPortfolioDirection[];
}) {
  const themes = midtermStrategy?.priorityStrategicThemes?.filter(Boolean) ?? [];
  const portfolioThemes = (businessPortfolioDirections ?? []).slice(0, 4);

  if (themes.length === 0 && portfolioThemes.length === 0) return null;

  return (
    <section className="mb-8 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <div className="mb-4 flex flex-col gap-1.5 border-b border-slate-100 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-700">
          Winning Patterns
        </p>
        <h3 className="text-lg font-bold text-slate-950">重点戦略と優先順位</h3>
        <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
          全社戦略を、STAGE3以降で展開すべき重点テーマとして整理します。
        </p>
      </div>

      {themes.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {themes.slice(0, 4).map((theme, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-3" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Strategic Theme {String(i + 1).padStart(2, '0')}
              </p>
              <p className="text-sm font-bold leading-relaxed text-slate-900">{theme}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {portfolioThemes.map((pd, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-3" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-950">{pd.segmentName}</p>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                  {portfolioDirectionLabels[pd.category]}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">{pd.basicDirection}</p>
              <p className="mt-2 border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">
                STAGE3論点：{pd.stage3Question}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 各章の詳細表示（2カラム：screen / 1カラム：pdf）
 */
function ChapterSection({
  chapter,
  index,
  meta,
  mode,
}: {
  chapter: StoryChapter;
  index: number;
  meta: (typeof CHAPTER_META)[0];
  mode?: 'screen' | 'pdf';
}) {
  const isPdf = mode === 'pdf';
  const cleanedTitle = cleanChapterTitle(chapter.title, index + 1);
  const pdfTitle = index === 3 && cleanedTitle.includes('どう行動する')
    ? (
      <>
        <span className="whitespace-nowrap">第{index + 1}章：どう行動する</span>
        <span className="ml-1">（社員一人ひとりの役割と決意）</span>
      </>
    )
    : <>第{index + 1}章：{cleanedTitle}</>;

  if (isPdf) {
    // PDF版：1カラム構成（改ページ対応）
    return (
      <div
        style={{ breakInside: 'auto', pageBreakInside: 'auto' }}
        className="mb-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
      >
        {/* 章ヘッダー */}
        <div className="mb-4 border-b border-slate-200 pb-3">
          <p className="text-xs font-bold tracking-[0.2em] text-slate-700 uppercase mb-2">
            Chapter {String(index + 1).padStart(2, '0')}
          </p>
          <h3 className="text-[20px] font-bold leading-snug text-slate-950 mb-1">
            {pdfTitle}
          </h3>
          <p className="text-sm text-slate-500">
            {meta.englishLabel} / {meta.japaneseLabel}
          </p>
        </div>

        {/* Key Message */}
        <div className="mb-5 rounded-lg border border-slate-200 border-l-4 border-l-slate-800 bg-slate-50 p-3.5">
          <p className="text-[10px] font-bold tracking-[0.18em] text-slate-700 uppercase mb-2">
            Key Message
          </p>
          <p className="text-[15px] font-semibold text-slate-900">
            {meta.defaultKeyMessage}
          </p>
        </div>

        {/* 本文 */}
        <div className="mb-5 space-y-2.5">
          {renderParagraphs(chapter.body, 'pdf') || (
            <p className="text-slate-400 italic">本文未入力</p>
          )}
        </div>

        {/* 3つのインサイトカード（横並び、ブロック全体でページ分断を防ぐ） */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          {/* 戦略上の示唆 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-1.5">
              Strategic Implications
            </p>
            <h5 className="text-[11px] font-bold text-slate-900 mb-2">
              戦略上の示唆
            </h5>
            <ul className="space-y-1 text-[10px] text-slate-700">
              {meta.strategicImplications.map((implication, i) => (
                <li key={i} className="flex gap-1 leading-snug">
                  <span className="shrink-0 text-slate-400 mt-0.5">−</span>
                  <span>{implication}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 次に接続する論点 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-1.5">
              Next Questions
            </p>
            <h5 className="text-[11px] font-bold text-slate-900 mb-2">
              次に接続する論点
            </h5>
            <ul className="space-y-1 text-[10px] text-slate-700">
              {meta.nextQuestions.map((question, i) => (
                <li key={i} className="flex gap-1 leading-snug">
                  <span className="shrink-0 text-slate-400 mt-0.5">−</span>
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* STAGE3/4への展開先 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            <p className="text-[9px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-1.5">
              Downstream Design
            </p>
            <h5 className="text-[11px] font-bold text-slate-900 mb-2">
              STAGE3/4への展開先
            </h5>
            <ul className="space-y-1 text-[10px] text-slate-700">
              {meta.downstreamTargets.map((target, i) => (
                <li key={i} className="flex gap-1 leading-snug">
                  <span className="shrink-0 text-slate-400 mt-0.5">−</span>
                  <span>{target}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Screen版：2カラム構成（現在のまま）
  return (
    <div className="mb-12 rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
      {/* 章ヘッダー */}
      <div className="mb-6 pb-4 border-b border-slate-200">
        <p className="text-xs font-bold tracking-[0.2em] text-slate-700 uppercase mb-2">
          Chapter {String(index + 1).padStart(2, '0')}
        </p>
        <h3 className="text-2xl font-bold text-slate-950 mb-2">
          {pdfTitle}
        </h3>
        <p className="text-sm text-slate-500">
          {meta.englishLabel} / {meta.japaneseLabel}
        </p>
      </div>

      {/* 2カラム（レスポンシブ） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* 左カラム（2/3） */}
        <div className="md:col-span-2">
          {/* Key Message */}
          <div className="rounded-lg border border-slate-200 border-l-4 border-l-slate-800 bg-slate-50 p-5 mb-7">
            <p className="text-[10px] font-bold tracking-[0.18em] text-slate-700 uppercase mb-2">
              Key Message
            </p>
            <p className="text-base font-semibold text-slate-900">
              {meta.defaultKeyMessage}
            </p>
          </div>

          {/* 本文 */}
          <div className="space-y-4">
            {renderParagraphs(chapter.body) || (
              <p className="text-slate-400 italic">本文未入力</p>
            )}
          </div>
        </div>

        {/* 右カラム（1/3）：Insight Panel */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          {/* 戦略上の示唆 */}
          <div className="mb-7">
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-3">
              Strategic Implications
            </p>
            <h5 className="text-sm font-bold text-slate-900 mb-3">
              戦略上の示唆
            </h5>
            <ul className="space-y-2 text-sm text-slate-700">
              {meta.strategicImplications.map((implication, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="shrink-0 text-slate-400 mt-1">−</span>
                  <span>{implication}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 次に接続する論点 */}
          <div className="mb-7 border-t border-slate-200 pt-6">
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-3">
              Next Questions
            </p>
            <h5 className="text-sm font-bold text-slate-900 mb-3">
              次に接続する論点
            </h5>
            <ul className="space-y-2 text-sm text-slate-700">
              {meta.nextQuestions.map((question, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="shrink-0 text-slate-400 mt-1">−</span>
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* STAGE3/4への展開先 */}
          <div className="border-t border-slate-200 pt-6">
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-3">
              Downstream Design
            </p>
            <h5 className="text-sm font-bold text-slate-900 mb-3">
              STAGE3/4への展開先
            </h5>
            <ul className="space-y-2 text-sm text-slate-700">
              {meta.downstreamTargets.map((target, i) => (
                <li key={i} className="flex gap-2 leading-relaxed">
                  <span className="shrink-0 text-slate-400 mt-1">−</span>
                  <span>{target}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * STAGE3以降への接続（控えめな導線）
 */
function StageConnectionSection() {
  return (
    <div className="mb-8 rounded-[24px] border border-slate-200 bg-white p-7 shadow-sm">
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Next Step
          </p>
          <h3 className="text-lg font-bold text-slate-950">
            次のステップ：事業・部門別戦略へ展開
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            この全社戦略は、STAGE3の事業・部門別戦略、STAGE4の実行計画・KPIへ展開されます。
            画面上では導線に留め、中期経営計画本文の主役は4章ストーリーと全社判断基準に置きます。
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-center">STAGE3</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-center">STAGE4</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-center">STAGE5</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-center">STAGE6</span>
        </div>
      </div>
    </div>
  );
}

/**
 * メインコンポーネント：StrategyStoryPreview
 */
export function StrategyStoryPreview({
  story,
  finalized,
  companyName,
  midtermStrategy,
  financialTargets,
  swotSuggestions,
  swotData,
  businessSegments,
  segmentPL,
  valueAnalysis,
  mode,
}: StrategyStoryPreviewProps) {
  if (!story || story.length === 0) return null;

  const strategicAssumptions = buildStrategicAssumptions({
    swotSuggestions,
    swotData,
    midtermStrategy,
  });

  const businessPortfolioDirections = buildBusinessPortfolioDirections({
    businessSegments,
    segmentPL,
    valueAnalysis,
    businessPortfolio: undefined,
  });

  return (
    <div className="space-y-10 bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* 表紙ヘッダー：ライトグレー基調＋チャコールアクセント */}
      <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-zinc-50 px-10 py-11 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
        <div className="absolute left-0 top-0 h-full w-1.5 bg-slate-800" aria-hidden="true" />
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">
              Mid-Term Management Plan
            </p>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-slate-950">
              全社戦略
            </h1>
            <p className="text-sm font-medium text-slate-600">経営戦略ストーリー</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {companyName && (
              <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                {companyName}
              </span>
            )}
            <span
              className={[
                'rounded-full border px-4 py-2 text-[11px] font-bold shadow-sm',
                finalized
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700',
              ].join(' ')}
            >
              {finalized ? '確定済' : 'ドラフト'}
            </span>
          </div>
        </div>
      </div>

      {/* コンテンツ本体 */}
      <div className={mode === 'pdf' ? 'max-w-5xl mx-auto px-4' : 'space-y-10 max-w-5xl mx-auto px-4'}>
        {mode === 'pdf' ? (
          <>
            {/* PDF版：実際のPDF分割を安定させるため、A4相当のページブロックで構成 */}
            <div style={{ minHeight: 1110, boxSizing: 'border-box', paddingBottom: 24 }}>
              <ConclusionBox />
              <StrategicAssumptionBlock assumptions={strategicAssumptions} />
            </div>

            <div style={{ minHeight: 1110, boxSizing: 'border-box', paddingBottom: 24 }}>
              <StoryFlowCards />
              {financialTargets && (
                <FinancialTargetGapPanel
                  revenue={financialTargets.revenue}
                  operatingProfit={financialTargets.operatingProfit}
                />
              )}
              <StrategicThemePanel
                midtermStrategy={midtermStrategy}
                businessPortfolioDirections={businessPortfolioDirections}
              />
            </div>

            {story.map((chapter, idx) => (
              <div key={idx} style={{ minHeight: 1110, boxSizing: 'border-box', paddingBottom: 24 }}>
                <ChapterSection
                  chapter={chapter}
                  index={idx}
                  meta={CHAPTER_META[idx] || CHAPTER_META[0]}
                  mode={mode}
                />
              </div>
            ))}

            <div style={{ minHeight: 520, boxSizing: 'border-box', paddingBottom: 64 }}>
              <StageConnectionSection />
            </div>
          </>
        ) : (
          <>
            {/* Screen版：現在のまま */}
            <ConclusionBox />
            <StrategicAssumptionBlock assumptions={strategicAssumptions} />
            <StoryFlowCards />
            <MidtermDesignBox
              midtermStrategy={midtermStrategy}
              businessSegments={businessSegments}
              valueAnalysis={valueAnalysis}
              businessPortfolioDirections={businessPortfolioDirections}
            />
            <div className="space-y-10">
              {story.map((chapter, idx) => (
                <ChapterSection
                  key={idx}
                  chapter={chapter}
                  index={idx}
                  meta={CHAPTER_META[idx] || CHAPTER_META[0]}
                  mode={mode}
                />
              ))}
            </div>
            {financialTargets && (
              <FinancialTargetGapPanel
                revenue={financialTargets.revenue}
                operatingProfit={financialTargets.operatingProfit}
              />
            )}
            <StageConnectionSection />
          </>
        )}
      </div>
    </div>
  );
}
