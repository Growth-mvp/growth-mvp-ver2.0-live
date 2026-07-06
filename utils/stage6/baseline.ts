/**
 * STAGE6 ベースライン生成ロジック
 * financePL から BaseTrajectory / BaseFigures を生成
 */

import type { BaseFigures, Ym } from '@/utils/simulationBridge';
import type { BaseTrajectory } from '@/utils/financeSimulation';

/**
 * 月を YYYY-MM から次の月へ遷移
 */
function nextYm(y: Ym): Ym {
  const [year, month] = y.split('-').map(Number);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return `${next[0]}-${String(next[1]).padStart(2, '0')}` as Ym;
}

/**
 * 月の範囲を生成（inclusive）
 */
function ymRange(startYm: Ym, endYm: Ym): Ym[] {
  const result: Ym[] = [];
  let current = startYm;
  while (current <= endYm) {
    result.push(current);
    current = nextYm(current);
  }
  return result;
}

/**
 * ★ Helper: 複数の可能なキー名から数値を抽出（キー名揺れ対応）
 * ★重要：0値を先に拾わない。すべての候補を見て、正の値があるものを優先
 */
function extractRevenue(pl: any): number | undefined {
  // 候補キーのリスト（優先順）
  const candidates = [
    'revenue',
    'sales',
    'salesRevenue',
    'sales_revenue',
    'netSales',
    'net_sales',
    '売上',
    '売上高',
    '売上高 *',
    '売上高（円）',
    '売上高(円)',
    '売上高_円',
  ];

  // ★ DEBUG: PLの全キーを確認（最初のみ）
  const DEBUG = process.env.NODE_ENV === 'development';
  if (DEBUG && pl && typeof pl === 'object') {
    const allKeys = Object.keys(pl);
    const foundCandidates = candidates.filter(k => k in pl);
    const foundValues = candidates
      .filter(k => k in pl)
      .map(k => ({ key: k, value: pl[k], type: typeof pl[k] }));

    console.group('[extractRevenue-DEBUG] PL structure analysis');
    console.log('All keys in PL:', allKeys);
    console.log('Candidates found:', foundCandidates);
    console.log('Candidate values:', foundValues);
    console.groupEnd();
  }

  // ★ Phase 1: 正の値のあるキーを探す（最優先）
  for (const key of candidates) {
    const val = pl?.[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      if (DEBUG) {
        console.log('[extractRevenue] found positive value: key=%s value=%s', key, val);
      }
      return val;
    }
  }

  // ★ Phase 2: 0 を含む有効な数値を探す（fallback）
  for (const key of candidates) {
    const val = pl?.[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      if (DEBUG) {
        console.log('[extractRevenue] found zero/fallback value: key=%s value=%s', key, val);
      }
      return val;
    }
  }

  // ★ Phase 3: 何も見つからない
  if (DEBUG) {
    console.log('[extractRevenue] no value found in candidates', { plKeys: Object.keys(pl ?? {}) });
  }
  return undefined;
}

function extractOperatingIncome(pl: any): number | undefined {
  if (typeof pl?.operatingIncome === 'number') return pl.operatingIncome;
  if (typeof pl?.operatingProfit === 'number') return pl.operatingProfit;
  if (typeof pl?.operating_profit === 'number') return pl.operating_profit;
  if (typeof pl?.opProfit === 'number') return pl.opProfit;
  if (typeof pl?.op === 'number') return pl.op;
  if (typeof pl?.['営業利益'] === 'number') return pl['営業利益'];
  return undefined;
}

/**
 * BaseFigures を financePL から生成
 * 最新実績年のPLを使って、デフォルト値・推定値をセット
 *
 * ★ 修正: 売上または営業利益の有効値を持つ最大年度を採用
 * - financePL が無い場合は null を返す（fallback 金額を禁止）
 * ★ 営業利益は Stage1実績を最優先（複数キー名対応）
 */
export function mkBaseFigures(strategyState: any): (BaseFigures & { operatingIncome?: number }) | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseFigures=null (no fallback)');
    return null;
  }

  // ★ 修正: 売上 or 営業利益の有効値を持つ最大年度を選ぶ
  const currentYear = new Date().getFullYear();
  const validPLs = pls.filter((pl: any) => {
    const rev = extractRevenue(pl);
    const op = extractOperatingIncome(pl);
    return (typeof rev === 'number' || typeof op === 'number') && pl.year <= currentYear;
  });

  if (validPLs.length === 0) {
    console.warn('[STAGE6] No valid PL row found (revenue/operatingIncome missing) for baseFigures');
    return null;
  }

  // 最大年度を選ぶ
  const basePL = validPLs.reduce((acc: any, cur: any) => cur.year > acc.year ? cur : acc);

  if (!basePL) {
    console.warn('[STAGE6] Failed to select basePL');
    return null;
  }

  const revenue = extractRevenue(basePL) ?? 0;
  const cogs = basePL?.cogs ?? 0;

  // ★ 営業利益は Stage1実績を最優先（-38円を尊重）複数キー名対応
  let opIncomeYen = extractOperatingIncome(basePL);
  if (typeof opIncomeYen !== 'number') {
    // 明示的な営業利益フィールドが無ければ計算で補填
    opIncomeYen = (revenue ?? 0) - (cogs ?? 0) - (basePL?.sga ?? 0);
  }

  // ★ DEBUG: mkBaseFigures の全処理をログ出力
  if (process.env.NODE_ENV === 'development') {
    console.group('[STAGE6 baseline debug] mkBaseFigures');
    console.log('latestRow:', basePL);
    console.log('extractRevenue result:', revenue);
    console.log('extractOperatingIncome result:', opIncomeYen);
  }

  const result = {
    revenue: revenue,
    acq: Math.max(1000, (revenue ?? 1) / (cogs ?? 1)),
    arpu: Math.max(
      50000,
      (revenue ?? 1) /
        Math.max(1000, (revenue ?? 1) / (cogs ?? 1)),
    ),
    churn: 0.02,
    fixed_cost: (basePL.sga ?? 0) / 12,
    variable_cost: cogs / 12,
    personnel_cost: (basePL.sga ?? 0) / 2 / 12,
    invest: 0,
    success_rate: 0.8,
    synergy: 0,
    // ★ TASK: 営業利益を保存（baselineYearly の計算で使用）
    operatingIncome: opIncomeYen,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('mkBaseFigures result:', result);
    console.groupEnd();
  }

  return result;
}

/**
 * BaseTrajectory を financePL から生成
 * 3年間の月次予測値をセット
 *
 * ★ 修正: 売上または営業利益の有効値を持つ最大年度を採用
 * - financePL.revenue は yen 永続と仮定（unit 推定なし）
 * - 計画年（未来年）も含めて、実績年の最大値を採用
 */
export function mkBaselineTrajectory(strategyState: any): BaseTrajectory | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseline missing');
    return null;
  }

  // ★ 修正: 売上 or 営業利益の有効値を持つ最大年度を選ぶ
  const currentYear = new Date().getFullYear();
  const validPLs = pls.filter((pl: any) => {
    const rev = extractRevenue(pl);
    const op = extractOperatingIncome(pl);
    return (typeof rev === 'number' || typeof op === 'number') && pl.year <= currentYear;
  });

  if (validPLs.length === 0) {
    console.warn('[STAGE6] No valid PL row found (revenue/operatingIncome missing)');
    return null;
  }

  // 最大年度を選ぶ
  const baselinePL = validPLs.reduce((acc: any, cur: any) => cur.year > acc.year ? cur : acc);

  if (!baselinePL) {
    console.warn('[STAGE6] Failed to select baselinePL');
    return null;
  }

  // ★ 必須フィールド確認: sga, cogs が無い場合は null を返す
  if (baselinePL.sga === undefined || baselinePL.cogs === undefined) {
    console.warn('[STAGE6] baselinePL missing required fields (sga/cogs) for trajectory');
    return null;
  }

  // ★ 営業利益は Stage1実績を最優先（複数キー名対応）
  const pickedYear = baselinePL.year;
  let opIncomeYen = extractOperatingIncome(baselinePL);
  if (typeof opIncomeYen !== 'number') {
    opIncomeYen = ((extractRevenue(baselinePL) ?? 0) - (baselinePL?.cogs ?? 0) - (baselinePL?.sga ?? 0));
  }

  // ★ ログ: 採用した baseline 年を出力（DEBUG時のみ）
  const DEBUG_BASELINE = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_STAGE6;
  if (DEBUG_BASELINE) {
    const revenue = extractRevenue(baselinePL);
    console.log('[baseline] pickedYear=%s rev=%s opIncome(raw)=%s opIncome(used)=%s cogs=%s sga=%s',
      pickedYear,
      revenue,
      extractOperatingIncome(baselinePL),
      opIncomeYen,
      baselinePL?.cogs,
      baselinePL?.sga
    );
  }

  const year = baselinePL.year;
  const startYm = `${year}-01` as Ym;
  const endYm = `${year + 3}-12` as Ym;

  const months = ymRange(startYm, endYm);
  // ★ financePL は yen 永続と仮定（unit 推定なし）
  const revenue = extractRevenue(baselinePL);

  // ★ DEBUG: revenue が抽出できているか確認
  if (process.env.NODE_ENV === 'development') {
    console.log('[mkBaselineTrajectory] revenue extracted:', {
      revenue,
      cogs: baselinePL.cogs,
      hasRevenue: typeof revenue === 'number',
    });
  }

  // ★ BUG-FIX: revenue が undefined または 0 の場合の処理
  // 0 の場合は無視して 1 にせず、undefined として処理
  if (!revenue || !Number.isFinite(revenue) || revenue <= 0) {
    console.warn('[STAGE6] mkBaselineTrajectory: revenue is invalid (0 or undefined):', {
      revenue,
      baselinePLYear: baselinePL.year,
      baselinePLKeys: Object.keys(baselinePL),
    });
    return null;
  }

  const monthlyQty = Math.max(1000, revenue / (baselinePL.cogs ?? 1));
  const monthlyArpu = Math.max(50000, revenue / monthlyQty);

  const result: BaseTrajectory = {
    startYm,
    endYm,
    qtyMonthly: {},
    arpuMonthly: {},
    churnMonthly: {},
    fixedCostMonthly: {},
    variableCostMonthly: {},
    personnelCostMonthly: {},
  };

  months.forEach((ym) => {
    result.qtyMonthly[ym] = monthlyQty / 12;
    result.arpuMonthly[ym] = monthlyArpu;
    result.churnMonthly[ym] = 0.02;
    result.fixedCostMonthly[ym] = baselinePL.sga / 12;
    result.variableCostMonthly[ym] = baselinePL.cogs / 12;
    result.personnelCostMonthly[ym] = baselinePL.sga / 2 / 12;
  });

  return result;
}
