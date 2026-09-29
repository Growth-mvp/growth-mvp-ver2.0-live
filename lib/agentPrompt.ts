// /lib/agentPrompt.ts
import { StrategyData, ChapterAnswers, ChapterStory } from '@/types/strategy';

function oneLine(str?: string) {
  return (str || '').replace(/\s+/g, ' ').trim();
}

function compactStory(story: ChapterStory[] = []) {
  return story
    .map((c, i) => `第${i + 1}章「${oneLine(c.title)}」: ${oneLine(c.body).slice(0, 240)}…`)
    .join('\n');
}

function formatAmount(n: number | undefined | null): string {
  if (n === null || n === undefined) return '';
  if (n === 0) return '0円';
  const absN = Math.abs(n);
  if (absN >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}十億円`;
  if (absN >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円`;
  if (absN >= 1_000) return `${(n / 1_000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}千円`;
  return `${n}円`;
}

function buildFinanceSummaryBlock(financeSummary: any[] = []): string {
  // ⑤ 検査: buildFinanceSummaryBlock への入力確認
  const isArray = Array.isArray(financeSummary);
  const count = isArray ? financeSummary.length : 0;
  console.log('[agentPrompt] ⑤_buildFinanceSummaryBlock input', {
    is_array: isArray,
    count: count,
    first_item_keys: count > 0 ? Object.keys(financeSummary[0] || {}).slice(0, 5) : [],
  });

  if (!isArray || count === 0) {
    console.log('[agentPrompt] ⑤_buildFinanceSummaryBlock -> empty (no data)');
    return '';
  }

  // 年度でソート（新→古）
  const sorted = [...financeSummary].sort((a, b) => {
    const yearA = typeof a?.year === 'number' ? a.year : 0;
    const yearB = typeof b?.year === 'number' ? b.year : 0;
    return yearB - yearA;
  });

  // ★ 出所明記と信頼性表示
  const lines: string[] = [
    '出所：GROWTH SHIFTのSTAGE1登録データ。公開決算のリアルタイム取得結果ではありません。',
    '',
    '【STAGE1 財務サマリ（GROWTH SHIFT登録データ）】'
  ];

  const yearsSummary: { year: number; has_revenue: boolean; has_operatingIncome: boolean; has_netIncome: boolean }[] = [];

  sorted.forEach((row: any) => {
    // ★ 年度表記：「XXXX年度」から「XXXX年3月期」に改善
    // 注：期末月情報がない場合はデフォルトで3月期と表示
    const yearLabel = typeof row?.year === 'number' ? `${row.year}年3月期` : '不明';
    const parts: string[] = [];

    const hasRevenue = row?.revenue !== undefined && row?.revenue !== null;
    const hasOpIncome = row?.operatingIncome !== undefined && row?.operatingIncome !== null;
    const hasNetIncome = row?.netIncome !== undefined && row?.netIncome !== null;

    if (hasRevenue) {
      parts.push(`売上 ${formatAmount(row.revenue)}`);
    }
    if (hasOpIncome) {
      parts.push(`営業利益 ${formatAmount(row.operatingIncome)}`);
    }
    if (hasNetIncome) {
      parts.push(`当期純利益 ${formatAmount(row.netIncome)}`);
    }

    if (parts.length > 0) {
      lines.push(`  ${yearLabel}: ${parts.join(' / ')}`);
    }

    // ★ 検証用：年度別のフィールド有無を記録
    if (typeof row?.year === 'number') {
      yearsSummary.push({
        year: row.year,
        has_revenue: hasRevenue,
        has_operatingIncome: hasOpIncome,
        has_netIncome: hasNetIncome,
      });
    }
  });

  // ★ 最終確認ログ：buildFinanceSummaryBlock の出力内容
  console.log('[agentPrompt] ⑤_buildFinanceSummaryBlock_FINAL', {
    block_created: lines.length > 1,
    years_with_data: yearsSummary,
  });

  const result = lines.length > 1 ? lines.join('\n') : '';
  console.log('[agentPrompt] ⑤_buildFinanceSummaryBlock output', {
    has_content: result.length > 0,
    output_length: result.length,
    line_count: lines.length,
  });
  return result;
}

function buildValueAnalysisBlock(valueAnalysis: any = {}): string {
  if (!valueAnalysis || typeof valueAnalysis !== 'object') {
    return '';
  }

  const lines: string[] = ['【STAGE1 5指標分析（GROWTH SHIFT登録データ）】'];

  // 基準年の表記
  const baseYear = valueAnalysis.baseYear || valueAnalysis.latestYear;
  if (baseYear) {
    lines.push(`  [基準年: ${baseYear}年]`);
  }

  // 売上成長率（CAGR推奨）
  const growth = valueAnalysis.revenueCagrPct !== undefined ? valueAnalysis.revenueCagrPct : valueAnalysis.revenueGrowthRate;
  if (typeof growth === 'number') {
    lines.push(`  ・売上成長率（CAGR）: ${growth.toFixed(1)}%`);
  }

  // 営業利益率
  const margin = valueAnalysis.operatingMarginPctLatest !== undefined ? valueAnalysis.operatingMarginPctLatest : valueAnalysis.operatingMarginRate;
  if (typeof margin === 'number') {
    lines.push(`  ・営業利益率: ${margin.toFixed(1)}%`);
  }

  // ROIC
  if (typeof valueAnalysis.roic === 'number') {
    lines.push(`  ・ROIC: ${valueAnalysis.roic.toFixed(1)}%`);
  }

  // ROE
  if (typeof valueAnalysis.roe === 'number') {
    lines.push(`  ・ROE: ${valueAnalysis.roe.toFixed(1)}%`);
  }

  // 負債資本比率
  if (typeof valueAnalysis.debtEquityRatio === 'number') {
    lines.push(`  ・負債資本比率: ${valueAnalysis.debtEquityRatio.toFixed(2)}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildExternalFinancialBlock(extData: any = {}): string {
  if (!extData || typeof extData !== 'object') {
    return '';
  }

  const lines: string[] = ['【外部決算情報（Web検索）】'];

  if (extData.companyName) {
    lines.push(`企業: ${extData.companyName}`);
  }

  if (extData.fiscalYear) {
    lines.push(`決算期: ${extData.fiscalYear}`);
  }

  if (extData.disclosureDate) {
    lines.push(`開示日: ${extData.disclosureDate}`);
  }

  if (extData.revenue !== undefined && extData.revenue !== null) {
    lines.push(`売上: ${formatAmount(extData.revenue)}`);
  }

  if (extData.operatingIncome !== undefined && extData.operatingIncome !== null) {
    lines.push(`営業利益: ${formatAmount(extData.operatingIncome)}`);
  }

  if (extData.netIncome !== undefined && extData.netIncome !== null) {
    lines.push(`当期純利益: ${formatAmount(extData.netIncome)}`);
  }

  if (extData.documentUrl) {
    lines.push(`資料URL: ${extData.documentUrl}`);
  }

  if (extData.sourceLabel) {
    lines.push(`出所: ${extData.sourceLabel}`);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

export { buildExternalFinancialBlock };

export function summarizeAnswers2(a2: ChapterAnswers[] = []) {
  return a2.map((c) => ({
    chapterIndex: c.chapterIndex,
    chapterTitle: c.chapterTitle,
    recent: (c.steps ?? [])
      .slice(-2)
      .map((s) => ({ stepNumber: s.stepNumber, q: s.question, a: s.answer })),
  }));
}

export function buildAgentSystemPrompt(
  s: Partial<StrategyData> = {},
  a2: ChapterAnswers[] = [],
  finalStory: ChapterStory[] = []
) {
  const parts: string[] = [];

  parts.push(`あなたは経営者の参謀AI。口調は簡潔・具体・検証的。\n`);

  parts.push(
    `【会社の前提】
業種:${s.industry ?? ''} / 売上:${s.revenue ?? ''} / 従業員:${s.employees ?? ''}
MVV: M=${oneLine(s.mission)} / V=${oneLine(s.vision)} / Va=${oneLine(s.value)}
SWOT: S=${oneLine(s.strength)} / W=${oneLine(s.weakness)} / O=${oneLine(s.opportunity)} / T=${oneLine(s.threat)}`
  );

  // STAGE1 財務データを埋め込む
  const financeSummaryBlock = buildFinanceSummaryBlock((s as any)?.financeSummary);
  if (financeSummaryBlock) {
    parts.push(financeSummaryBlock);
  }

  const valueAnalysisBlock = buildValueAnalysisBlock((s as any)?.valueAnalysis);
  if (valueAnalysisBlock) {
    parts.push(valueAnalysisBlock);
  }

  if (finalStory?.length) {
    parts.push('【戦略ストーリー要約】\n' + compactStory(finalStory));
  }

  if (a2?.length) {
    parts.push('【直近の掘り下げQA（各章の最新2件）】\n' + JSON.stringify(summarizeAnswers2(a2), null, 2));
  }

  parts.push(`【振る舞い規範】
- 事実/仮説/提案をラベル付け
- 答えは箇条書き→最後に1行サマリ
- 可能なら次アクションを3件提示
- ツールが使えるときは関数呼び出しを提案し、必要データを質問して最小入力で実行
- 業績について質問される場合、STAGE1 財務サマリと5指標分析の登録データを優先参照してください

【STAGE1 データの扱い】
- 財務表（売上・利益・費用）：登録データのみ使用、出所「STAGE1登録」と明記
- 戦略・施策（費用削減・新製品・市場戦略）：STAGE2ストーリーと登録データのみ根拠とする
- 財務表に現れない推測（費用上昇・設備稼働・市場縮小など）：別データに根拠がない限り「仮説」と明示
- データ不足の判断：推測や想定は「推測ですが」と明記してください

【外部決算情報の扱い】
- 公開企業の場合、決算資料・EDINETなどの公開情報を優先参照
- 複数の出所がある場合（STAGE1登録データと外部資料）：両方を示す（出所を明記）
- 数値が食い違う場合：「STAGE1登録では売上XXX円、最新決算資料ではYYY円」と記載
- 外部検索に失敗した場合：「外部決算情報を確認できませんでした。STAGE1登録データのみ参照」と明記`);

  return parts.join('\n\n');
}

// 互換用：defaultでも呼べるように
export default function agentPrompt(
  s?: Partial<StrategyData>,
  a2?: ChapterAnswers[],
  finalStory?: ChapterStory[]
) {
  return buildAgentSystemPrompt(s, a2, finalStory);
}
