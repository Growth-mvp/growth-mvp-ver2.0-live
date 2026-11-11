/**
 * /components/stage2/StrategyStoryPreview.tsx
 *
 * 全社戦略書。STAGE2の最終確定画面と全社戦略書PDFで同じ内容を描画する。
 */

import React, { useEffect, useState } from 'react';
import type { MidtermStrategy, StoryChapter } from '@/types/strategy';
import {
  buildStrategicAssumptions,
  resolveConclusion,
  resolveStrategicAssumptions,
  type FinancialTargetRow,
  type StrategicAssumptions,
} from '@/lib/stage2/finalDocument';

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

const COMPANY_DERIVED_SOURCES: ReadonlyArray<BusinessPortfolioDirection['source']> = [
  'valueAnalysis',
  'segmentPL',
  'businessSegments',
  'businessPortfolio',
];

export type FinancialTargets = {
  revenue?: FinancialTargetRow;
  operatingProfit?: FinancialTargetRow;
};

interface StrategyStoryPreviewProps {
  story: StoryChapter[];
  finalized: boolean;
  companyName?: string;
  midtermStrategy?: MidtermStrategy;
  financialTargets?: FinancialTargets;
  swotSuggestions?: any;
  swotData?: any;
  businessSegments?: any[];
  segmentPL?: Record<string, any[]>;
  valueAnalysis?: any;
  businessPortfolio?: any;
  mode?: 'screen' | 'pdf';

  /** 保存済みの結論・前提の編集値（未編集なら undefined） */
  conclusionDraft?: string;
  assumptionsDraft?: Partial<StrategicAssumptions>;
  aiGeneratedConclusion?: string;

  isEditMode?: boolean;
  onConclusionChange?: (conclusion: string) => void;
  onAssumptionsChange?: (assumptions: StrategicAssumptions) => void;
  onMidtermStrategyChange?: (midtermStrategy: MidtermStrategy) => void;
}

function stripIssueSummary(text: string): string {
  return text.replace(/【.*?】[\s\S]*?(?=\n\n|$)/g, '').trim();
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


function parseItems(text: string): string[] {
  return text.split('\n').filter((s) => s.trim());
}

/** 入力途中の改行を保持するため、表示文字列はローカルに持ち、確定した項目だけを親へ渡す */
function ItemListEditor({
  items,
  onChange,
  rows,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  rows: number;
  placeholder?: string;
}) {
  const itemsKey = items.join('\n');
  const [text, setText] = useState(itemsKey);

  useEffect(() => {
    setText((current) => (parseItems(current).join('\n') === itemsKey ? current : itemsKey));
  }, [itemsKey]);

  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseItems(e.target.value));
      }}
      className="w-full p-3 border border-slate-300 rounded-lg text-sm leading-relaxed resize-vertical font-sans"
      rows={rows}
      placeholder={placeholder ?? '各項目を1行ずつ入力...'}
    />
  );
}

function EmptyText({ text = '未入力' }: { text?: string }) {
  return <p className="text-sm text-slate-400">（{text}）</p>;
}

function TextField({
  isEditMode,
  value,
  onChange,
  rows = 3,
  placeholder,
  variant,
}: {
  isEditMode?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  rows?: number;
  placeholder?: string;
  variant: 'screen' | 'pdf';
}) {
  if (isEditMode) {
    return (
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full p-3 border border-slate-300 rounded-lg text-sm leading-relaxed resize-vertical font-sans"
        rows={rows}
        placeholder={placeholder}
      />
    );
  }
  return renderParagraphs(value ?? '', variant) || <EmptyText />;
}

function ListField({
  isEditMode,
  items,
  onChange,
  rows = 4,
}: {
  isEditMode?: boolean;
  items: string[];
  onChange?: (items: string[]) => void;
  rows?: number;
}) {
  if (isEditMode) {
    return <ItemListEditor items={items} onChange={(next) => onChange?.(next)} rows={rows} />;
  }
  if (items.length === 0) return <EmptyText />;
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 text-slate-400">・</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DocSection({
  title,
  isPdf,
  children,
}: {
  title: string;
  isPdf: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="space-y-6 pt-6"
      style={{
        borderTop: '2px solid #0f172a',
        ...(isPdf ? { breakInside: 'avoid', pageBreakInside: 'avoid' } : {}),
      }}
    >
      <h2 className="text-xl font-bold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-bold text-slate-800">{label}</h3>
      {children}
    </div>
  );
}

function formatTargetValue(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

function FinancialTargetTable({ targets }: { targets?: FinancialTargets }) {
  const rows = [
    { label: '売上', target: targets?.revenue },
    { label: '営業利益', target: targets?.operatingProfit },
  ].filter((row): row is { label: string; target: FinancialTargetRow } => !!row.target);

  if (rows.length === 0) return <EmptyText text="数値目標は未登録" />;

  return (
    <table className="w-full border-collapse text-sm text-slate-800">
      <thead>
        <tr className="border-b border-slate-300 text-left text-xs text-slate-500">
          <th className="py-2 pr-4 font-semibold">項目</th>
          <th className="py-2 pr-4 font-semibold">目標値</th>
          <th className="py-2 font-semibold">目標年度</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, target }) => (
          <tr key={label} className="border-b border-slate-100">
            <td className="py-2 pr-4">{label}</td>
            <td className="py-2 pr-4 font-semibold">
              {formatTargetValue(target.base)} {target.unit}
            </td>
            <td className="py-2">{target.dueYear ? `${target.dueYear}年度` : '未設定'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
  businessPortfolio,
  mode = 'screen',
  conclusionDraft,
  assumptionsDraft,
  aiGeneratedConclusion,
  isEditMode,
  onConclusionChange,
  onAssumptionsChange,
  onMidtermStrategyChange,
}: StrategyStoryPreviewProps) {
  if (!story || story.length === 0) return null;

  const isPdf = mode === 'pdf';
  const variant = isPdf ? 'pdf' : 'screen';
  const midterm: MidtermStrategy = midtermStrategy ?? {};
  const conclusion = resolveConclusion(conclusionDraft, aiGeneratedConclusion);
  const assumptions = resolveStrategicAssumptions(
    assumptionsDraft,
    buildStrategicAssumptions({ swotSuggestions, swotData, midtermStrategy: midterm }),
  );
  const portfolio = buildBusinessPortfolioDirections({
    businessSegments,
    segmentPL,
    valueAnalysis,
    businessPortfolio,
  }).filter((d) => COMPANY_DERIVED_SOURCES.includes(d.source));
  const updateMidterm = (patch: Partial<MidtermStrategy>) => onMidtermStrategyChange?.({ ...midterm, ...patch });
  const updateAssumptions = (patch: Partial<StrategicAssumptions>) => onAssumptionsChange?.({ ...assumptions, ...patch });

  return (
    <article className={isPdf ? 'space-y-10 px-4' : 'mx-auto max-w-5xl space-y-10 px-4'}>
      <header className="border-b-4 border-slate-900 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">全社戦略書</h1>
        <p className="mt-2 text-lg font-semibold text-slate-800">{companyName || '（会社名未入力）'}</p>
        <div className="mt-4 flex flex-wrap gap-6 text-sm text-slate-700">
          <span
            className={
              finalized ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'
            }
          >
            状態：{finalized ? '確定版' : 'ドラフト（未確定）'}
          </span>
        </div>
      </header>

      <DocSection title="経営戦略の結論" isPdf={isPdf}>
        <TextField
          isEditMode={isEditMode}
          value={isEditMode ? conclusionDraft ?? aiGeneratedConclusion : conclusion}
          onChange={onConclusionChange}
          rows={6}
          placeholder="結論を入力..."
          variant={variant}
        />
      </DocSection>

      <DocSection title="経営目標・重点戦略" isPdf={isPdf}>
        <FieldBlock label="目指す姿">
          <TextField
            isEditMode={isEditMode}
            value={midterm.targetVisionForMidterm}
            onChange={(value) => updateMidterm({ targetVisionForMidterm: value })}
            variant={variant}
          />
        </FieldBlock>
        <FieldBlock label="中計の基本コンセプト">
          <TextField
            isEditMode={isEditMode}
            value={midterm.midtermConcept}
            onChange={(value) => updateMidterm({ midtermConcept: value })}
            variant={variant}
          />
        </FieldBlock>
        <FieldBlock label="数値目標">
          <FinancialTargetTable targets={financialTargets} />
        </FieldBlock>
        <FieldBlock label="重点戦略テーマ">
          <ListField
            isEditMode={isEditMode}
            items={midterm.priorityStrategicThemes ?? []}
            onChange={(items) => updateMidterm({ priorityStrategicThemes: items })}
          />
        </FieldBlock>
      </DocSection>

      <DocSection title="戦略判断の前提" isPdf={isPdf}>
        <FieldBlock label="外部環境">
          <ListField
            isEditMode={isEditMode}
            items={assumptions.external}
            onChange={(items) => updateAssumptions({ external: items })}
            rows={4}
          />
        </FieldBlock>
        <FieldBlock label="内部環境">
          <ListField
            isEditMode={isEditMode}
            items={assumptions.internal}
            onChange={(items) => updateAssumptions({ internal: items })}
            rows={4}
          />
        </FieldBlock>
        <FieldBlock label="戦略上の含意">
          <ListField
            isEditMode={isEditMode}
            items={assumptions.implications}
            onChange={(items) => updateAssumptions({ implications: items })}
            rows={3}
          />
        </FieldBlock>
      </DocSection>

      {story.map((chapter, index) => {
        const title = cleanChapterTitle(chapter.title, index + 1);
        return (
          <section key={index} className="space-y-6 pt-6" style={{ borderTop: '2px solid #0f172a' }}>
            <h2 className="text-xl font-bold text-slate-950">第{index + 1}章：{title}</h2>
            <div className="space-y-4">
              {renderParagraphs(chapter.body, variant) || <EmptyText text="本文未入力" />}
            </div>
          </section>
        );
      })}

      <DocSection title="全社共通の判断基準・部門展開の基本方針" isPdf={isPdf}>
        <FieldBlock label="全社共通の判断基準">
          <ListField
            isEditMode={isEditMode}
            items={midterm.companyWideDecisionCriteria ?? []}
            onChange={(items) => updateMidterm({ companyWideDecisionCriteria: items })}
          />
        </FieldBlock>
        <FieldBlock label="部門・社員への展開方針">
          <ListField
            isEditMode={isEditMode}
            items={midterm.deploymentPrinciplesForUnits ?? []}
            onChange={(items) => updateMidterm({ deploymentPrinciplesForUnits: items })}
          />
        </FieldBlock>
        <FieldBlock label="事業ポートフォリオの基本方針">
          <TextField
            isEditMode={isEditMode}
            value={midterm.portfolioPolicy}
            onChange={(value) => updateMidterm({ portfolioPolicy: value })}
            variant={variant}
          />
        </FieldBlock>
        {portfolio.length > 0 && (
          <FieldBlock label="事業別の基本方向">
            <div className="space-y-3">
              {portfolio.map((pd, i) => (
                <div key={i} className="border-l-2 border-slate-300 pl-4">
                  <p className="font-semibold text-slate-900">
                    {pd.segmentName}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {portfolioDirectionLabels[pd.category]}
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed text-slate-700">{pd.basicDirection}</p>
                </div>
              ))}
            </div>
          </FieldBlock>
        )}
      </DocSection>
    </article>
  );
}
