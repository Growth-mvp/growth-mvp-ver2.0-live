import type { CfBasis, CfValue } from './cashflow';

export type LoanCategory = 'BANK' | 'BOND' | 'LEASE' | 'SHAREHOLDER' | 'OTHER';
export type RepaymentMethod = 'EQUAL_PRINCIPAL' | 'BULLET';

export type ExistingLoanInput = {
  id: string;
  name: string;
  category: LoanCategory;
  /** 基準年度末残高（円） */
  balanceYen: number | null;
  /** 年利（小数。0.02 = 2%） */
  annualRate: number | null;
  /** 年度別の元本返済予定額（円）。未入力は null/未定義 */
  scheduledPrincipalYen: Record<number, number | null | undefined>;
};

export type NewLoanInput = {
  id: string;
  name: string;
  /** 借入実行年度 */
  drawYear: number | null;
  /** 借入実行月（1〜12）。未入力は年初（1月）実行と仮定して利息を計算する */
  drawMonth: number | null;
  amountYen: number | null;
  annualRate: number | null;
  /** 返済期間（年）。据置期間を含む */
  termYears: number | null;
  /** 据置期間（年）。元本返済を始めるまでの年数 */
  graceYears: number | null;
  method: RepaymentMethod;
};

export type DebtInput = {
  forecastYears: number[];
  existingLoans: ExistingLoanInput[];
  newLoans: NewLoanInput[];
  stage1InterestBearingDebtYen: number | null;
  dividendsYen: Record<number, number | null | undefined>;
  fiscalYearEndSet: boolean;
};

export type DebtYear = {
  year: number;
  openingBalance: CfValue;
  draw: CfValue;
  principal: CfValue;
  closingBalance: CfValue;
  newClosingBalance: CfValue;
  interest: CfValue;
  debtService: CfValue;
  existingPrincipal: CfValue;
  existingInterest: CfValue;
  newPrincipal: CfValue;
  newInterest: CfValue;
  dividends: CfValue;
  holds: string[];
};

export type DebtSchedule = {
  years: DebtYear[];
  reconciliation: {
    status: 'NOT_ENTERED' | 'MATCH' | 'DIFFERENT';
    statedTotalYen: number | null;
    stage1InterestBearingDebtYen: number | null;
    differenceYen: number | null;
  };
  existingLoansEntered: boolean;
  newLoansEntered: boolean;
  globalHolds: string[];
  assumptions: string[];
};

type LoanLine = {
  opening: number | null;
  draw: number | null;
  principal: number | null;
  interest: number | null;
  closing: number | null;
  holds: string[];
};

const RECONCILE_TOLERANCE_YEN = 1;

const CATEGORY_LABEL: Record<LoanCategory, string> = {
  BANK: '銀行借入',
  BOND: '社債',
  LEASE: 'リース',
  SHAREHOLDER: '株主・役員借入',
  OTHER: 'その他',
};
export const LOAN_CATEGORY_LABEL = CATEGORY_LABEL;

const isInt = (v: number | null): v is number => v !== null && Number.isInteger(v);

function simulateExisting(loan: ExistingLoanInput, years: number[]): LoanLine[] {
  const out: LoanLine[] = [];
  let bal: number | null = loan.balanceYen;
  for (const y of years) {
    const holds: string[] = [];
    const opening = bal;
    if (opening === null) holds.push(`${loan.name}：基準年度末残高が未入力`);
    if (loan.annualRate === null) holds.push(`${loan.name}：金利が未入力`);

    const raw = loan.scheduledPrincipalYen[y];
    let principal: number | null = null;
    if (raw === undefined || raw === null) {
      holds.push(`${loan.name}：${y}年の元本返済予定額が未入力`);
    } else if (raw < 0) {
      holds.push(`${loan.name}：${y}年の元本返済予定額が負の値です`);
    } else if (opening !== null && raw > opening) {
      holds.push(`${loan.name}：${y}年の元本返済予定額が残高を超えています`);
    } else {
      principal = raw;
    }

    const interest = opening !== null && loan.annualRate !== null ? opening * loan.annualRate : null;
    const closing = opening !== null && principal !== null ? opening - principal : null;
    out.push({ opening, draw: 0, principal, interest, closing, holds });
    bal = closing;
  }
  return out;
}

function validateNew(loan: NewLoanInput): string[] {
  const missing: string[] = [];
  if (!isInt(loan.drawYear)) missing.push('借入実行年度');
  if (loan.amountYen === null || loan.amountYen < 0) missing.push('借入金額');
  if (loan.annualRate === null || loan.annualRate < 0) missing.push('金利');
  if (!isInt(loan.termYears) || (loan.termYears as number) < 1) missing.push('返済期間（1年以上の整数）');
  if (loan.method === 'EQUAL_PRINCIPAL') {
    const grace = loan.graceYears ?? 0;
    if (!isInt(grace) || grace < 0 || (isInt(loan.termYears) && grace >= (loan.termYears as number))) {
      missing.push('据置期間（0以上かつ返済期間より短い整数）');
    }
  }
  return missing;
}

function simulateNew(loan: NewLoanInput, years: number[]): LoanLine[] {
  const missing = validateNew(loan);
  if (missing.length > 0) {
    return years.map(() => ({
      opening: null,
      draw: null,
      principal: null,
      interest: null,
      closing: null,
      holds: [`${loan.name}：${missing.join('・')}が未入力または不正`],
    }));
  }
  const drawYear = loan.drawYear as number;
  const term = loan.termYears as number;
  const grace = loan.method === 'EQUAL_PRINCIPAL' ? (loan.graceYears ?? 0) : 0;
  const rate = loan.annualRate as number;
  const amount = loan.amountYen as number;
  const month = loan.drawMonth ?? 1;
  const repayYears = term - grace;
  const equalPrincipal = repayYears > 0 ? Math.round(amount / repayYears) : 0;

  const out: LoanLine[] = [];
  let bal = 0;
  for (const y of years) {
    if (y < drawYear) {
      out.push({ opening: 0, draw: 0, principal: 0, interest: 0, closing: 0, holds: [] });
      continue;
    }
    if (y === drawYear) {
      const interest = amount * rate * ((13 - month) / 12);
      bal = amount;
      out.push({ opening: 0, draw: amount, principal: 0, interest, closing: amount, holds: [] });
      continue;
    }
    const k = y - drawYear;
    const opening = bal;
    const interest = opening * rate;
    let principal = 0;
    if (loan.method === 'BULLET') {
      if (k >= term) principal = opening;
    } else if (k > grace && k <= term) {
      principal = k === term ? opening : Math.min(equalPrincipal, opening);
    } else if (k > term) {
      principal = opening;
    }
    const closing = opening - principal;
    out.push({ opening, draw: 0, principal, interest, closing, holds: [] });
    bal = closing;
  }
  return out;
}

function sumLines(lines: LoanLine[], pick: (l: LoanLine) => number | null): number | null {
  if (lines.length === 0) return 0;
  let total = 0;
  for (const line of lines) {
    const v = pick(line);
    if (v === null) return null;
    total += v;
  }
  return total;
}

const value = (v: number | null, basis: CfBasis, note: string): CfValue =>
  v === null ? { value: null, basis: 'HELD', note } : { value: v, basis, note };

export function buildDebtSchedule(input: DebtInput): DebtSchedule {
  const years = input.forecastYears;
  const assumptions: string[] = [
    '利息は年初残高に年利を乗じ、元本返済は各年度末に行うと仮定',
    '借入実行年度の利息は実行月から年末まで按分（実行月未入力は1月実行と仮定）',
    '利息は営業CFの税引後利益に反映し、財務CFでは控除しない（二重控除防止）',
  ];

  const existingLines = input.existingLoans.map((l) => simulateExisting(l, years));
  const newLines = input.newLoans.map((l) => simulateNew(l, years));
  if (input.newLoans.some((l) => l.drawMonth === null)) {
    assumptions.push('実行月が未入力の新規借入は1月実行として利息を計算（推計前提）');
  }

  const globalHolds: string[] = [];
  const existingLoansEntered = input.existingLoans.length > 0;
  const newLoansEntered = input.newLoans.length > 0;
  if (!existingLoansEntered) {
    globalHolds.push('既存借入の内訳が未入力のため、既存借入の返済・利息は推定していません（評価保留）');
  }
  if (!input.fiscalYearEndSet) {
    globalHolds.push('決算期が未設定のため、PL年度と借入の年度の対応を確認できません（返済可能性の判定を保留）');
  }

  const statedTotal = existingLoansEntered
    ? input.existingLoans.reduce<number | null>((acc, l) => (acc === null || l.balanceYen === null ? null : acc + l.balanceYen), 0)
    : null;
  const stage1 = input.stage1InterestBearingDebtYen;
  let reconciliation: DebtSchedule['reconciliation'];
  if (statedTotal === null || stage1 === null) {
    reconciliation = {
      status: 'NOT_ENTERED',
      statedTotalYen: statedTotal,
      stage1InterestBearingDebtYen: stage1,
      differenceYen: null,
    };
  } else {
    const diff = statedTotal - stage1;
    reconciliation = {
      status: Math.abs(diff) < RECONCILE_TOLERANCE_YEN ? 'MATCH' : 'DIFFERENT',
      statedTotalYen: statedTotal,
      stage1InterestBearingDebtYen: stage1,
      differenceYen: diff,
    };
  }
  if (reconciliation.status === 'DIFFERENT') {
    globalHolds.push(
      `既存借入の内訳合計がSTAGE1の有利子負債合計と一致しません（差額 ${(reconciliation.differenceYen ?? 0).toLocaleString('ja-JP')} 円）`,
    );
  }
  if (reconciliation.status === 'NOT_ENTERED') {
    globalHolds.push('既存借入の内訳合計とSTAGE1の有利子負債合計を照合できていません');
  }
  globalHolds.push('有利子負債合計には借入金以外（リース等）が含まれる場合があります。内訳で確認してください');

  const yearsOut: DebtYear[] = years.map((y, i) => {
    const ex = existingLines.map((s) => s[i]);
    const nw = newLines.map((s) => s[i]);
    const holds = [...ex.flatMap((l) => l.holds), ...nw.flatMap((l) => l.holds)];
    if (!existingLoansEntered) holds.push('既存借入の内訳が未入力');

    const exPrincipal = existingLoansEntered ? sumLines(ex, (l) => l.principal) : null;
    const exInterest = existingLoansEntered ? sumLines(ex, (l) => l.interest) : null;
    const exOpening = existingLoansEntered ? sumLines(ex, (l) => l.opening) : null;
    const exClosing = existingLoansEntered ? sumLines(ex, (l) => l.closing) : null;

    const nwDraw = sumLines(nw, (l) => l.draw);
    const nwPrincipal = sumLines(nw, (l) => l.principal);
    const nwInterest = sumLines(nw, (l) => l.interest);
    const nwOpening = sumLines(nw, (l) => l.opening);
    const nwClosing = sumLines(nw, (l) => l.closing);

    const principal = exPrincipal !== null && nwPrincipal !== null ? exPrincipal + nwPrincipal : null;
    const interest = exInterest !== null && nwInterest !== null ? exInterest + nwInterest : null;
    const opening = exOpening !== null && nwOpening !== null ? exOpening + nwOpening : null;
    const closing = exClosing !== null && nwClosing !== null ? exClosing + nwClosing : null;
    const debtService = principal !== null && interest !== null ? principal + interest : null;

    const rawDiv = input.dividendsYen[y];
    const dividends: CfValue =
      rawDiv === undefined || rawDiv === null
        ? { value: null, basis: 'HELD', note: '配当額が未入力です（0とは見なしていません）' }
        : { value: rawDiv, basis: 'USER', note: '利用者指定' };
    if (dividends.value === null) holds.push('配当額が未入力');

    return {
      year: y,
      openingBalance: value(opening, 'ESTIMATE', '年初の借入残高（既存＋新規）'),
      draw: value(nwDraw, 'USER', newLoansEntered ? '新規借入（利用者入力）' : '新規借入の入力なし（0として計算）'),
      principal: value(principal, 'ESTIMATE', '既存・新規の元本返済額の合計'),
      closingBalance: value(closing, 'ESTIMATE', '年末の借入残高（既存＋新規）'),
      newClosingBalance: value(nwClosing, 'ESTIMATE', '年末の新規借入残高'),
      interest: value(interest, 'ESTIMATE', '既存・新規の支払利息の合計'),
      debtService: value(debtService, 'ESTIMATE', '元本返済＋支払利息'),
      existingPrincipal: value(exPrincipal, 'USER', '既存借入の元本返済（内訳入力）'),
      existingInterest: value(exInterest, 'ESTIMATE', '既存借入の支払利息（年初残高×金利）'),
      newPrincipal: value(nwPrincipal, 'ESTIMATE', '新規借入の元本返済（返済方式による）'),
      newInterest: value(nwInterest, 'ESTIMATE', '新規借入の支払利息'),
      dividends,
      holds: [...new Set(holds)],
    };
  });

  return {
    years: yearsOut,
    reconciliation,
    existingLoansEntered,
    newLoansEntered,
    globalHolds,
    assumptions,
  };
}
