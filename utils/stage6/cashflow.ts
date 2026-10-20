import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { DebtSchedule } from './debt';

export type CfBasis = 'ACTUAL' | 'ESTIMATE' | 'USER' | 'REGISTERED' | 'HELD';

export type CfValue = {
  value: number | null;
  basis: CfBasis;
  note?: string;
};

export type CfAssumptions = {
  minCashYen: number | null;
  taxRate: number | null;
  depreciationYen: number | null;
  arRatio: number | null;
  inventoryRatio: number | null;
  apRatio: number | null;
  targetRevenueYen: number | null;
  targetOperatingIncomeYen: number | null;
  targetYear: number | null;
};

export type InvestmentYearlyCategory = {
  fiscalYear: number;
  CAPEX: number;
  OPEX: number;
  OTHER: number;
};

export type CashFlowInput = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  investment: {
    yearlyByCategory: InvestmentYearlyCategory[];
    unclassifiedYen: number;
    unscheduledYen: number;
    candidateYen: number;
    basisPendingYen: number;
  };
  assumptions: CfAssumptions;
  horizonYears?: number;
  /** Phase 3：借入・返済計画。未指定の場合は Phase 2 の計算（基準年度の利息を据置）のまま */
  debt?: DebtSchedule;
  /** 決算期が確認できているか（未確認なら返済可能性の判定を保留）。未指定は確認済みとみなす */
  fiscalYearEndSet?: boolean;
};

export type CfYear = {
  year: number;
  kind: 'ACTUAL' | 'FORECAST';
  revenue: CfValue;
  operatingIncome: CfValue;
  netIncome: CfValue;
  depreciation: CfValue;
  interest: CfValue;
  workingCapital: CfValue;
  workingCapitalChange: CfValue;
  operatingCf: CfValue;
  capex: CfValue;
  investingCf: CfValue;
  fcf: CfValue;
  opexRegistered: number;
  otherRegistered: number;
  openingCash: CfValue;
  closingCashBeforeFinancing: CfValue;
  minCash: CfValue;
  shortfall: CfValue;
  draws: CfValue;
  principal: CfValue;
  dividends: CfValue;
  financingCf: CfValue;
  closingCashAfterFinancing: CfValue;
  postShortfall: CfValue;
  debtService: CfValue;
  dscr: CfValue;
  verdict: string;
  holds: string[];
};

export type CashFlowPlan = {
  baseYear: number | null;
  bsBaseYear: number | null;
  yearMismatch: boolean;
  unitSuspects: string[];
  globalHolds: string[];
  taxRate: CfValue;
  depreciation: CfValue;
  interest: CfValue;
  workingCapitalRatios: { ar: CfValue; inventory: CfValue; ap: CfValue };
  scenario: { basis: CfBasis; note: string };
  historicalWorkingCapital: { year: number; ar: number | null; inventory: number | null; ap: number | null }[];
  debtEnabled: boolean;
  debtGlobalHolds: string[];
  years: CfYear[];
};

const DEFAULT_HORIZON = 3;
const LARGE_REVENUE_YEN = 1_000_000;
const UNIT_SUSPECT_BELOW_YEN = 1_000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const actual = (value: number | null, note?: string): CfValue => ({ value, basis: 'ACTUAL', note });
const held = (note: string): CfValue => ({ value: null, basis: 'HELD', note });
const notApplicable = (): CfValue => ({ value: null, basis: 'ACTUAL', note: '実績年度のため推計対象外' });

function unitSuspectsOf(pl: FinancePLRow[], bs: FinanceBSRow[]): string[] {
  const out: string[] = [];
  const plRevenue = new Map(pl.map((r) => [r.year, num(r.revenue)]));
  for (const row of pl) {
    const revenue = plRevenue.get(row.year);
    if (revenue === null || revenue === undefined || revenue < LARGE_REVENUE_YEN) continue;
    const fields: [string, number | null][] = [
      ['営業利益', num(row.operatingIncome)],
      ['当期純利益', num(row.netIncome)],
      ['減価償却費', num(row.depreciation)],
      ['支払利息', num(row.interest)],
    ];
    const bad = fields.filter(([, v]) => v !== null && v !== 0 && Math.abs(v) < UNIT_SUSPECT_BELOW_YEN).map(([n]) => n);
    if (bad.length > 0) out.push(`${row.year}年のPL（${bad.join('・')}）`);
  }
  for (const row of bs) {
    const revenue = num(pl.find((r) => r.year === row.year)?.revenue);
    if (revenue === null || revenue < LARGE_REVENUE_YEN) continue;
    const fields: [string, number | null][] = [
      ['現預金', num(row.cash)],
      ['売掛金', num(row.ar)],
      ['棚卸資産', num(row.inventory)],
      ['買掛金', num(row.ap)],
    ];
    const bad = fields.filter(([, v]) => v !== null && v !== 0 && Math.abs(v) < UNIT_SUSPECT_BELOW_YEN).map(([n]) => n);
    if (bad.length > 0) out.push(`${row.year}年のBS（${bad.join('・')}）`);
  }
  return out;
}

function verdictOf(args: {
  held: boolean;
  postCash: number | null;
  minCash: number | null;
  dscr: number | null;
  noService: boolean;
  fiscalYearEndSet: boolean;
}): string {
  if (args.held || args.postCash === null || args.minCash === null) return '評価保留';
  if (!args.fiscalYearEndSet) return '評価保留（決算期未設定）';
  if (args.postCash < args.minCash) return '資金不足（返済後の現預金が最低必要現預金を下回る）';
  if (args.noService) return '返済予定なし（DSCR算出不可）';
  if (args.dscr === null) return '評価保留';
  if (args.dscr < 1) return '返済原資が元利返済を下回る（DSCR 1倍未満）';
  return '計算上は資金不足・DSCR不足なし（簡易指標。金融機関の審査指標とは異なります）';
}

export function buildCashFlowPlan(
  input: CashFlowInput,
  currentYear: number = new Date().getFullYear(),
): CashFlowPlan {
  const horizon = input.horizonYears ?? DEFAULT_HORIZON;
  const a = input.assumptions;
  const debt = input.debt;
  const globalHolds: string[] = [];

  const plRows = input.financePL
    .filter((r) => num(r?.year) !== null && r.year <= currentYear)
    .slice()
    .sort((x, y) => x.year - y.year);
  const bsRows = input.financeBS
    .filter(
      (r) =>
        num(r?.year) !== null &&
        r.year <= currentYear &&
        [r.cash, r.ar, r.inventory, r.ap].some((v) => num(v) !== null),
    )
    .slice()
    .sort((x, y) => x.year - y.year);

  const baseRow = [...plRows].reverse().find((r) => num(r.revenue) !== null);
  const bsBase = bsRows.length > 0 ? bsRows[bsRows.length - 1] : undefined;
  const baseYear = baseRow?.year ?? null;
  const bsBaseYear = bsBase?.year ?? null;
  const yearMismatch = baseYear !== null && bsBaseYear !== null && baseYear !== bsBaseYear;

  if (!baseRow) globalHolds.push('STAGE1に売上高のある実績年度がないため、推計できません');
  if (!bsBase) globalHolds.push('STAGE1に現預金・売掛金などのBS実績がないため、資金推計を保留しています');
  if (yearMismatch) {
    globalHolds.push(
      `PLの基準年度（${baseYear}年）とBSの基準年度（${bsBaseYear}年）が異なるため、資金推計を保留しています`,
    );
  }

  const unitSuspects = unitSuspectsOf(plRows, bsRows);
  if (unitSuspects.length > 0) {
    globalHolds.push(`単位不一致の疑いがあるため、資金推計を保留しています：${unitSuspects.join('、')}`);
  }

  const baseOk = baseRow !== undefined && bsBase !== undefined && !yearMismatch && unitSuspects.length === 0;
  const Y = baseRow?.year ?? null;

  const rev0 = num(baseRow?.revenue);
  const oi0 = num(baseRow?.operatingIncome);
  const int0 = num(baseRow?.interest);
  const dep0 = num(baseRow?.depreciation);
  const ni0 = num(baseRow?.netIncome);
  const tax0 = num(baseRow?.tax);
  const cash0 = num(bsBase?.cash);
  const ar0 = num(bsBase?.ar);
  const inv0 = num(bsBase?.inventory);
  const ap0 = num(bsBase?.ap);

  const pretax0 = oi0 !== null && int0 !== null ? oi0 - int0 : null;
  let taxRate: CfValue;
  if (a.taxRate !== null) {
    taxRate = { value: a.taxRate, basis: 'USER', note: '利用者指定' };
  } else if (pretax0 !== null && pretax0 > 0 && tax0 !== null) {
    const r = tax0 / pretax0;
    taxRate =
      r >= 0 && r <= 1
        ? { value: r, basis: 'ESTIMATE', note: '基準年度の法人税等÷税引前利益' }
        : held('基準年度の法人税等から算出した税率が0〜100%の範囲外です');
  } else if (pretax0 !== null && pretax0 > 0 && ni0 !== null) {
    const r = 1 - ni0 / pretax0;
    taxRate =
      r >= 0 && r <= 1
        ? { value: r, basis: 'ESTIMATE', note: '基準年度の純利益から逆算（1 − 純利益÷税引前利益）' }
        : held('基準年度の純利益から算出した税率が0〜100%の範囲外です');
  } else {
    taxRate = held('税率が未確定です（利用者指定、または法人税等・純利益・支払利息の実績が必要）');
  }

  const depreciation: CfValue =
    a.depreciationYen !== null
      ? { value: a.depreciationYen, basis: 'USER', note: '利用者指定（各年度で同額）' }
      : dep0 !== null
        ? { value: dep0, basis: 'ESTIMATE', note: '基準年度の実績を据え置き' }
        : held('減価償却費の実績がなく、利用者指定もありません');

  const interest: CfValue =
    int0 !== null
      ? { value: int0, basis: 'ESTIMATE', note: '基準年度の実績を据え置き（借入の内訳を入力すると借入計画の利息に置き換わります）' }
      : held('支払利息の実績がありません');

  const ratioFor = (user: number | null, value: number | null, label: string): CfValue => {
    if (user !== null) return { value: user, basis: 'USER', note: `${label}（利用者指定）` };
    if (value !== null && rev0 !== null && rev0 > 0) {
      return { value: value / rev0, basis: 'ESTIMATE', note: `${label}（基準年度の売上高に対する比率を据え置き）` };
    }
    return held(`${label}を算出できません（基準年度の実績または利用者指定が必要）`);
  };
  const arR = ratioFor(a.arRatio, ar0, '売上債権比率');
  const invR = ratioFor(a.inventoryRatio, inv0, '棚卸資産比率');
  const apR = ratioFor(a.apRatio, ap0, '仕入債務比率');

  const wcY = ar0 !== null && inv0 !== null && ap0 !== null ? ar0 + inv0 - ap0 : null;

  const historicalWorkingCapital = bsRows
    .map((row) => {
      const revenue = num(plRows.find((r) => r.year === row.year)?.revenue);
      const ratio = (v: number | null) => (v !== null && revenue !== null && revenue > 0 ? v / revenue : null);
      return { year: row.year, ar: ratio(num(row.ar)), inventory: ratio(num(row.inventory)), ap: ratio(num(row.ap)) };
    })
    .filter((r) => r.ar !== null || r.inventory !== null || r.ap !== null);

  const hasScenario = a.targetRevenueYen !== null || a.targetOperatingIncomeYen !== null || a.targetYear !== null;
  let scenarioBasis: CfBasis = 'ESTIMATE';
  let scenarioNote = '横ばい（推計シナリオ未指定）';
  let targetYear: number | null = null;
  if (hasScenario && Y !== null) {
    targetYear = a.targetYear ?? Y + horizon;
    scenarioBasis = 'USER';
    scenarioNote = '利用者指定の推計シナリオ（正式な目標ではありません）';
    if (targetYear <= Y) globalHolds.push('推計シナリオの目標年度は基準年度より後である必要があります');
  }
  const scenarioValid = !hasScenario || (targetYear !== null && Y !== null && targetYear > Y);

  const pathValue = (base: number | null, target: number | null, t: number): number | null => {
    if (base === null) return null;
    if (!hasScenario || target === null || targetYear === null || !scenarioValid) return base;
    if (t >= targetYear) return target;
    return base + ((target - base) * (t - (Y as number))) / (targetYear - (Y as number));
  };

  const yearlyCat = new Map(input.investment.yearlyByCategory.map((r) => [r.fiscalYear, r]));

  const { unclassifiedYen, unscheduledYen, candidateYen, basisPendingYen } = input.investment;
  const unresolved = [
    unclassifiedYen > 0 ? `分類未確定 ${unclassifiedYen.toLocaleString('ja-JP')} 円` : '',
    unscheduledYen > 0 ? `時期未設定 ${unscheduledYen.toLocaleString('ja-JP')} 円` : '',
    candidateYen > 0 ? `重複確認中 ${candidateYen.toLocaleString('ja-JP')} 円` : '',
    basisPendingYen > 0 ? `金額基準未確認 ${basisPendingYen.toLocaleString('ja-JP')} 円` : '',
  ].filter(Boolean);
  if (unresolved.length > 0) {
    globalHolds.push(`未確定の投資・費用は資金計画に含めていません（${unresolved.join('、')}）`);
  }
  if (a.minCashYen === null) {
    globalHolds.push('最低必要現預金が未入力のため、必要資金額・不足額は評価保留です');
  }
  globalHolds.push('STAGE4に登録のない通常の設備更新投資は未反映です');
  globalHolds.push('営業CFにはその他の調整項目を含めていません（OPEXは営業利益計画に含まれている前提で、二重に控除していません）');
  if (Y !== null && !hasScenario) {
    globalHolds.push('売上高・営業利益は基準年度の横ばいとして推計しています（推計シナリオ未指定）');
  }
  if (!debt) {
    globalHolds.push('借入・返済計画は未入力です。財務CF（借入・元本返済・配当）は算出していません');
  }
  if (input.fiscalYearEndSet === false) {
    globalHolds.push('決算月が未設定のため、投資額は暦年（12月期）として仮に集計しており、年度別の投資CF・資金計画は確定値ではありません');
  }

  const debtYearOf = (t: number) => debt?.years.find((d) => d.year === t);
  const fiscalYearEndSet = input.fiscalYearEndSet ?? true;

  const years: CfYear[] = [];

  if (baseRow && Y !== null) {
    years.push({
      year: Y,
      kind: 'ACTUAL',
      revenue: actual(rev0, '基準年度の実績'),
      operatingIncome: actual(oi0, '基準年度の実績'),
      netIncome: actual(ni0, '基準年度の実績'),
      depreciation: actual(dep0, '基準年度の実績'),
      interest: actual(int0, '基準年度の実績'),
      workingCapital: actual(wcY, '基準年度BSの売掛金＋棚卸資産−買掛金'),
      workingCapitalChange: notApplicable(),
      operatingCf: notApplicable(),
      capex: notApplicable(),
      investingCf: notApplicable(),
      fcf: notApplicable(),
      opexRegistered: 0,
      otherRegistered: 0,
      openingCash: notApplicable(),
      closingCashBeforeFinancing: actual(cash0, '基準年度BSの現預金'),
      minCash: notApplicable(),
      shortfall: notApplicable(),
      draws: notApplicable(),
      principal: notApplicable(),
      dividends: notApplicable(),
      financingCf: notApplicable(),
      closingCashAfterFinancing: actual(cash0, '基準年度BSの現預金'),
      postShortfall: notApplicable(),
      debtService: notApplicable(),
      dscr: notApplicable(),
      verdict: '実績年度',
      holds: [],
    });
  }

  let prevChain: number | null = baseOk && cash0 !== null ? cash0 : null;
  let prevWc: number | null = baseOk && wcY !== null ? wcY : null;
  const allRatiosKnown = arR.value !== null && invR.value !== null && apR.value !== null;

  for (let step = 1; step <= horizon && Y !== null; step++) {
    const t = Y + step;
    const holds: string[] = [];
    const missing: string[] = [];
    const dy = debtYearOf(t);

    const revValue = baseOk ? pathValue(rev0, a.targetRevenueYen, t) : null;
    const oiValue = baseOk ? pathValue(oi0, a.targetOperatingIncomeYen, t) : null;
    const revenue: CfValue =
      revValue !== null ? { value: revValue, basis: scenarioBasis, note: scenarioNote } : held('基準年度の売上高が確定していません');
    const operatingIncome: CfValue =
      oiValue !== null ? { value: oiValue, basis: scenarioBasis, note: scenarioNote } : held('基準年度の営業利益が確定していません');

    // 支払利息：借入計画があれば借入計画の利息（既存＋新規）、なければ基準年度の据置
    let interestValue: number | null;
    let interestCf: CfValue;
    if (debt) {
      interestValue = dy?.interest.value ?? null;
      interestCf = dy
        ? { ...dy.interest, note: '借入計画の支払利息（既存＋新規）' }
        : held('借入計画に該当年度がありません');
      if (dy?.interest.value === null) missing.push('借入計画の支払利息');
    } else {
      interestValue = int0;
      interestCf = interest;
      if (int0 === null) missing.push('支払利息');
    }

    const pretax = oiValue !== null && interestValue !== null ? oiValue - interestValue : null;
    if (pretax === null && !missing.includes('営業利益・支払利息')) missing.push('営業利益・支払利息');
    const rate = taxRate.value;
    if (rate === null) missing.push('税率');
    const netIncomeValue = pretax !== null && rate !== null ? (pretax > 0 ? pretax * (1 - rate) : pretax) : null;
    const netIncome: CfValue =
      netIncomeValue !== null
        ? { value: netIncomeValue, basis: 'ESTIMATE', note: '営業利益から推計（支払利息・税率を控除）' }
        : held('税引後利益を推計できません');

    const dep = depreciation.value;
    if (dep === null) missing.push('減価償却費');

    const wcValue =
      allRatiosKnown && revValue !== null
        ? (arR.value as number) * revValue + (invR.value as number) * revValue - (apR.value as number) * revValue
        : null;
    if (!allRatiosKnown) missing.push('運転資金比率');
    const wcChange = wcValue !== null && prevWc !== null ? wcValue - prevWc : null;
    if (wcChange === null && wcValue !== null && prevWc === null) missing.push('基準年度の運転資金');

    const workingCapital: CfValue =
      wcValue !== null ? { value: wcValue, basis: 'ESTIMATE', note: '基準年度の比率×推計売上高' } : held('運転資金を推計できません');
    const workingCapitalChange: CfValue =
      wcChange !== null
        ? { value: wcChange, basis: 'ESTIMATE', note: '前年度末との差（初年度は基準年度の実績との差）' }
        : held('運転資金増減を算出できません');

    const ocfValue =
      netIncomeValue !== null && dep !== null && wcChange !== null ? netIncomeValue + dep - wcChange : null;
    const operatingCf: CfValue =
      ocfValue !== null
        ? { value: ocfValue, basis: 'ESTIMATE', note: '税引後利益＋減価償却費−運転資金増加（推計）' }
        : held('営業CFを算出できません');

    const yc = yearlyCat.get(t);
    const capexValue = yc ? yc.CAPEX : 0;
    const capex: CfValue = {
      value: capexValue,
      basis: 'REGISTERED',
      note: yc ? 'STAGE4の確定済み資本的支出' : 'STAGE4に確定済みの資本的支出の登録なし',
    };
    const investingCf: CfValue = {
      value: capexValue === 0 ? 0 : -capexValue,
      basis: 'REGISTERED',
      note: '資本的支出を支出として計上',
    };

    const fcfValue = ocfValue !== null ? ocfValue - capexValue : null;
    const fcf: CfValue =
      fcfValue !== null ? { value: fcfValue, basis: 'ESTIMATE', note: '営業CF＋投資CF（推計）' } : held('FCFを算出できません');

    const openingCash: CfValue =
      prevChain !== null
        ? { value: prevChain, basis: step === 1 ? 'ACTUAL' : 'ESTIMATE', note: step === 1 ? '基準年度の現預金（実績）' : '前年度末の推計値' }
        : held('期首現預金が確定していません');

    const preValue = prevChain !== null && fcfValue !== null ? prevChain + fcfValue : null;
    const pre: CfValue =
      preValue !== null
        ? { value: preValue, basis: 'ESTIMATE', note: '期首＋営業CF＋投資CF（借入の元本返済・配当・新規借入は含まない）' }
        : held('期末現預金を算出できません');

    const minValue = a.minCashYen;
    const minCash: CfValue =
      minValue !== null ? { value: minValue, basis: 'USER', note: '利用者指定' } : held('最低必要現預金が未入力です');
    const shortfallValue = preValue !== null && minValue !== null ? Math.max(0, minValue - preValue) : null;
    const shortfall: CfValue =
      shortfallValue !== null
        ? { value: shortfallValue, basis: 'ESTIMATE', note: '借入反映前の参考値。新規借入必要額の確定値ではありません' }
        : held('不足額を判定できません');

    // Phase 3：財務CF
    let drawsCf: CfValue = held('借入計画が未入力');
    let principalCf: CfValue = held('借入計画が未入力');
    let dividendsCf: CfValue = held('借入計画が未入力');
    let financingValue: number | null = null;
    let postValue: number | null = null;
    if (debt && dy) {
      drawsCf = dy.draw;
      principalCf = dy.principal;
      dividendsCf = dy.dividends;
      if (dy.draw.value !== null && dy.principal.value !== null && dy.dividends.value !== null) {
        financingValue = dy.draw.value - dy.principal.value - dy.dividends.value;
      }
      holds.push(...dy.holds);
    } else if (debt) {
      holds.push('借入計画に該当年度がありません');
    }
    if (preValue !== null && financingValue !== null) postValue = preValue + financingValue;
    if (debt && financingValue === null) missing.push('財務CF（借入・返済・配当）');
    const financingCf: CfValue =
      financingValue !== null
        ? { value: financingValue, basis: 'USER', note: '新規借入 − 元本返済 − 配当（利息は営業CFで控除済み）' }
        : held(debt ? '財務CFを算出できません' : '借入・返済計画が未入力');
    const closingAfter: CfValue =
      postValue !== null
        ? { value: postValue, basis: 'ESTIMATE', note: '期末現預金（借入反映後）＝期首＋営業CF＋投資CF＋財務CF' }
        : held(debt ? '借入反映後の期末現預金を算出できません' : '借入計画が未入力のため算出していません');
    const postShortfallValue = postValue !== null && minValue !== null ? Math.max(0, minValue - postValue) : null;
    const postShortfall: CfValue =
      postShortfallValue !== null
        ? { value: postShortfallValue, basis: 'ESTIMATE', note: '借入反映後の最低必要現預金との差（不足額）' }
        : held('借入反映後の不足額を判定できません');

    // DSCR = （営業CF＋支払利息）÷（元本返済＋支払利息）
    const principalValue = dy?.principal.value ?? null;
    const debtServiceValue =
      debt && dy && principalValue !== null && interestValue !== null ? principalValue + interestValue : null;
    const debtService: CfValue =
      debtServiceValue !== null
        ? { value: debtServiceValue, basis: 'ESTIMATE', note: '元本返済＋支払利息' }
        : held(debt ? '元利返済額を算出できません' : '借入計画が未入力');
    const noService = debtServiceValue === 0;
    let dscrValue: number | null = null;
    if (debtServiceValue !== null && debtServiceValue > 0 && ocfValue !== null && interestValue !== null) {
      dscrValue = (ocfValue + interestValue) / debtServiceValue;
    }
    const dscr: CfValue =
      dscrValue !== null
        ? {
            value: dscrValue,
            basis: 'ESTIMATE',
            note: 'DSCR＝（営業CF＋支払利息）÷（元本返済＋支払利息）。簡易指標で、金融機関の審査指標とは異なります',
          }
        : noService
          ? { value: null, basis: 'ESTIMATE', note: '元利返済予定がないためDSCRを算出しません' }
          : held('DSCRを算出できません');

    const chainClosing = debt ? postValue : preValue;
    const verdict = verdictOf({
      held: missing.length > 0 || !baseOk,
      postCash: postValue,
      minCash: minValue,
      dscr: dscrValue,
      noService,
      fiscalYearEndSet,
    });

    if (!baseOk) holds.push('基準年度の確認（PL/BSの年度・単位）が完了していないため保留');
    for (const m of missing) holds.push(`${m}が不足`);
    if (capexValue === 0 && !yc) holds.push('STAGE4に確定済みの資本的支出の登録なし（通常の設備更新は未反映）');

    years.push({
      year: t,
      kind: 'FORECAST',
      revenue,
      operatingIncome,
      netIncome,
      depreciation:
        depreciation.value !== null ? { value: depreciation.value, basis: depreciation.basis, note: depreciation.note } : held('減価償却費が未確定です'),
      interest: interestCf,
      workingCapital,
      workingCapitalChange,
      operatingCf,
      capex,
      investingCf,
      fcf,
      opexRegistered: yc ? yc.OPEX : 0,
      otherRegistered: yc ? yc.OTHER : 0,
      openingCash,
      closingCashBeforeFinancing: pre,
      minCash,
      shortfall,
      draws: drawsCf,
      principal: principalCf,
      dividends: dividendsCf,
      financingCf,
      closingCashAfterFinancing: closingAfter,
      postShortfall,
      debtService,
      dscr,
      verdict,
      holds: [...new Set(holds)],
    });

    prevChain = chainClosing;
    prevWc = wcValue;
  }

  return {
    baseYear: Y,
    bsBaseYear,
    yearMismatch,
    unitSuspects,
    globalHolds,
    taxRate,
    depreciation,
    interest,
    workingCapitalRatios: { ar: arR, inventory: invR, ap: apR },
    scenario: { basis: scenarioBasis, note: scenarioNote },
    historicalWorkingCapital,
    debtEnabled: debt !== undefined,
    debtGlobalHolds: debt ? debt.globalHolds : [],
    years,
  };
}

