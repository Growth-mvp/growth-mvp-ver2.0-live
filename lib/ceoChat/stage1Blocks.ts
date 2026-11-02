// STAGE1 財務・5指標の CEO チャット向けブロック（agentPrompt と route で共有）
export function formatAmount(n: number | undefined | null): string {
  if (n === null || n === undefined) return '';
  if (n === 0) return '0円';
  const absN = Math.abs(n);
  if (absN >= 1_000_000_000) return `${(n / 1_000_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}十億円`;
  if (absN >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}百万円`;
  if (absN >= 1_000) return `${(n / 1_000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}千円`;
  return `${n}円`;
}

export function buildFinanceSummaryBlock(financeSummary: any[] = []): string {
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

const NO_DATA = 'データなし（算出に必要な登録データが不足）';

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function buildValueAnalysisBlock(valueAnalysis: any = {}, stage1Benchmarks?: any): string {
  const va = valueAnalysis && typeof valueAnalysis === 'object' ? valueAnalysis : {};

  const growth = finiteNumber(va.revenueCagrPct) ?? finiteNumber(va.revenueGrowthRate);
  const margin = finiteNumber(va.operatingMarginPctLatest) ?? finiteNumber(va.operatingMarginRate);
  const roic = finiteNumber(va.roic);
  const waccRaw = finiteNumber(
    typeof stage1Benchmarks?.waccManual === 'string' ? Number(stage1Benchmarks.waccManual) : stage1Benchmarks?.waccManual
  );
  const wacc = waccRaw != null && waccRaw > 0 ? waccRaw : undefined;
  const pbr = finiteNumber(va.pbr);
  const industryRoic = finiteNumber(stage1Benchmarks?.industryMedian?.metrics?.roicPct);
  const industryPeriod = typeof stage1Benchmarks?.industryMedian?.period === 'string'
    ? stage1Benchmarks.industryMedian.period.trim()
    : '';

  const basisYears: number[] = (Array.isArray(va.meta?.basis?.years) ? va.meta.basis.years : [])
    .map((y: unknown) => Number(y))
    .filter((y: number) => Number.isFinite(y))
    .sort((a: number, b: number) => a - b);
  const firstYear = basisYears.length > 0 ? basisYears[0] : undefined;
  const latestYear =
    finiteNumber(va.meta?.basis?.latestYear) ?? (basisYears.length > 0 ? basisYears[basisYears.length - 1] : undefined);

  const roicNotes: string[] = (Array.isArray(va.meta?.notes) ? va.meta.notes : []).filter(
    (n: unknown): n is string => typeof n === 'string' && /ROIC|税率|参考値|投下資本/.test(n)
  );

  const periodText =
    firstYear != null && latestYear != null && firstYear !== latestYear
      ? `${firstYear}年〜${latestYear}年`
      : latestYear != null
        ? `${latestYear}年`
        : 'データなし';

  const taxNote = roicNotes.some((n) => n.includes('税率は仮定値'))
    ? '税率は仮定値30%を使用'
    : '税率は登録値（PL）を使用';
  const industryLine =
    industryRoic != null
      ? `  業界比較（ROIC・業界中央値の登録値）: ${industryRoic.toFixed(1)}%${industryPeriod ? `（${industryPeriod}）` : ''}。差は述べてよいが、水準の良否は断定しない`
      : '  業界比較（ROIC）: 登録なし。業界内で良いか悪いかは判断しない';

  return [
    '【STAGE1 企業価値5指標（GROWTH SHIFT登録データから算出。STAGE1画面と同じ計算）】',
    `  対象年度: ${periodText}（ROIC・営業利益率は最新年 ${latestYear != null ? `${latestYear}年` : 'データなし'}）`,
    '  値の種別: ①②③は登録データからの計算値、④は登録値、⑤は手入力値',
    `  ① 売上成長率（CAGR・年率）: ${growth != null ? `${growth.toFixed(1)}%（${firstYear ?? '—'}→${latestYear ?? '—'}年）【計算値】` : NO_DATA}`,
    `  ② 営業利益率（最新年）: ${margin != null ? `${margin.toFixed(1)}%【計算値・${latestYear ?? '—'}年】` : NO_DATA}`,
    `  ③ ROIC（NOPAT÷投下資本）: ${roic != null ? `${roic.toFixed(1)}%${roicNotes.length > 0 ? `（注記: ${roicNotes.join('、')}）` : ''}【計算値・${latestYear ?? '—'}年】` : NO_DATA}`,
    ...(roic != null
      ? [`  ROICの算式: 営業利益×(1−税率)÷投下資本（投下資本は登録された純資産＋有利子負債など）。${taxNote}`]
      : []),
    industryLine,
    `  ④ WACC（登録値）: ${wacc != null ? `${wacc.toFixed(1)}%【登録値。計算値ではない】` : NO_DATA}`,
    `  ⑤ PBR（手入力値）: ${pbr != null ? `${pbr.toFixed(2)}倍【手入力値】` : NO_DATA}`,
    '  財務評価の注意:',
    '  - 回答では対象年度と算式を示し、上の数値だけを使う。数値を推測で補わない。',
    '  - 業界比較がない場合、「良好」「高い」「低い」などの水準を断定しない。',
    '  - ROICがWACCを上回るときは、その差を説明するに留める。「企業価値を創出している」とは断定しない（税率と年度に依存する計算値のため）。',
    '  - 専門用語は一言で説明する（例：ROIC＝事業に投じたお金に対して、税引き後の利益がどれだけあるかの割合）。',
    '  数値が「データなし」の指標は、推測せず「データなし」と答えてください。',
  ].join('\n');
}
