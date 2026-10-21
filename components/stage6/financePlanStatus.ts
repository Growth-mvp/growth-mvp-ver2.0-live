import type { CashFlowPlan, CfYear } from '@/utils/stage6/cashflow';
import type { DebtSchedule } from '@/utils/stage6/debt';
import type { Freshness } from '@/utils/stage6/financePlanSnapshot';
import type { InvestmentItem, buildInvestmentDemandSummary } from '@/utils/stage6/investmentDemand';
import { MILLION } from './financePlanForm';

export type FinanceTab = 'target' | 'investment' | 'cashflow' | 'debt' | 'verdict';

export const FINANCE_TABS: readonly { key: FinanceTab; label: string; description: string }[] = [
  {
    key: 'target',
    label: '1. 目標に届くか',
    description:
      '経営目標に対して、現場の取り組みがどれだけ貢献するかを確認します。目標との差を把握し、必要な施策を見直します。',
  },
  {
    key: 'investment',
    label: '2. いくら必要か',
    description: '現場の取り組みに必要な投資や費用を確認します。金額や支出時期が決まっていない項目も整理します。',
  },
  {
    key: 'cashflow',
    label: '3. お金は足りるか',
    description: '売上や利益の見通しをもとに、事業で生まれるお金と必要になるお金を試算します。',
  },
  {
    key: 'debt',
    label: '4. 借入・返済を考える',
    description: '現在の借入と今後の借入予定を整理し、毎年いくら返済する必要があるかを確認します。',
  },
  {
    key: 'verdict',
    label: '5. 計画は成り立つか',
    description:
      '資金繰りや返済の見通しを確認し、計画を進めるうえでの問題と見直すべき点を明らかにします。',
  },
];

export function tabLabelOf(tab: FinanceTab): string {
  return FINANCE_TABS.find((t) => t.key === tab)?.label ?? '';
}

export function moveLabelOf(tab: FinanceTab): string {
  return `「${tabLabelOf(tab)}」へ移動`;
}

export type InvestmentSummary = ReturnType<typeof buildInvestmentDemandSummary>;

export type UnconfirmedItem = {
  key: string;
  label: string;
  required: boolean;
  tab: FinanceTab;
};

export function buildUnconfirmedItems(args: {
  investment: InvestmentSummary;
  existingLoanCount: number;
  debtEntered: boolean;
  minCashEntered: boolean;
  plan: CashFlowPlan;
  schedule: DebtSchedule;
}): UnconfirmedItem[] {
  const { investment: inv, plan, schedule } = args;
  const items: UnconfirmedItem[] = [];
  const add = (key: string, label: string, tab: FinanceTab, required: boolean) =>
    items.push({ key, label, tab, required });

  if (args.existingLoanCount === 0) {
    add('debt-existing', '既存借入の明細が未入力（既存借入の返済・利息は評価保留）', 'debt', true);
  }
  if (schedule.reconciliation.status === 'DIFFERENT') {
    add('debt-reconcile', '既存借入の内訳合計がSTAGE1の有利子負債と一致しません', 'debt', true);
  }
  if (args.debtEntered && schedule.years.some((y) => y.holds.includes('配当額が未入力'))) {
    add('debt-dividend', '配当額が未入力のため、借入・返済によるお金の増減は評価保留', 'debt', true);
  }

  if (!args.minCashEntered) {
    add('cf-mincash', '手元に残しておきたいお金が未入力のため、必要資金額・不足額は評価保留', 'cashflow', true);
  }
  if (plan.yearMismatch) {
    add('cf-year-mismatch', 'PLとBSの基準年度が異なるため推計を保留しています', 'cashflow', true);
  }
  const cfMissing = Array.from(
    new Set(
      plan.years
        .filter((y) => y.kind === 'FORECAST')
        .flatMap((y) => y.holds)
        .filter((h) => h.endsWith('不足')),
    ),
  );
  if (cfMissing.length > 0) {
    add('cf-missing', `キャッシュフローの前提が不足しています（${cfMissing.join('、')}）`, 'cashflow', true);
  }

  if (inv.fiscalYearEndMonth === null) {
    add('inv-fiscal-year-end', '決算月が未設定のため暦年（12月期）として集計しています', 'investment', true);
  }
  if (inv.unclassifiedCount > 0) {
    add('inv-unclassified', `分類未確定の投資・費用 ${inv.unclassifiedCount}件（集計に含まれていません）`, 'investment', true);
  }
  if (inv.unscheduledYen > 0 || inv.periodicUnresolvedCount > 0) {
    add('inv-unscheduled', '支出時期が未設定、または期間未確定の投資・費用があります', 'investment', true);
  }
  if (inv.candidateCount > 0) {
    add('inv-candidate', `重複確認中の投資・費用 ${inv.candidateCount}件（集計から除外）`, 'investment', true);
  }
  if (inv.basisPendingCount > 0 || inv.unitPendingCount > 0) {
    add('inv-basis', '金額の基準（総額・月額・年額）または単位が未確認の投資・費用があります', 'investment', true);
  }
  if (inv.missingCount > 0) {
    add('inv-missing', `金額が未入力の投資・費用 ${inv.missingCount}件`, 'investment', true);
  }
  if (inv.unapprovedReadyYen > 0) {
    add('inv-unapproved', '未承認（草案・レビュー中・未設定）の投資を集計に含んでいます', 'investment', false);
  }

  return [...items.filter((i) => i.required), ...items.filter((i) => !i.required)];
}

export type RepaymentOutlook = {
  label: string;
  detail: string;
  tone: 'ok' | 'warn' | 'hold';
};

export function repaymentOutlook(args: { debtEntered: boolean; years: CfYear[] }): RepaymentOutlook {
  const { years } = args;
  if (!args.debtEntered) {
    return { label: '評価保留', detail: '借入・配当が未入力です', tone: 'hold' };
  }
  const yearsWith = (prefix: string) => years.filter((y) => y.verdict.startsWith(prefix)).map((y) => `${y.year}年`);
  const shortYears = yearsWith('資金不足');
  if (shortYears.length > 0) {
    return { label: '資金不足あり', detail: shortYears.join('、'), tone: 'warn' };
  }
  const dscrYears = yearsWith('返済原資');
  if (dscrYears.length > 0) {
    return { label: '返済余力が不足', detail: dscrYears.join('、'), tone: 'warn' };
  }
  const heldYears = yearsWith('評価保留');
  if (heldYears.length > 0 || years.length === 0) {
    return { label: '評価保留', detail: heldYears.join('、') || '判定対象の年度がありません', tone: 'hold' };
  }
  if (years.every((y) => y.verdict.startsWith('返済予定なし'))) {
    return { label: '返済予定なし', detail: '元利返済がないためDSCRは算出していません', tone: 'ok' };
  }
  return { label: '計算上の問題なし', detail: '簡易判定です（金融機関の審査とは同一とは限りません）', tone: 'ok' };
}

export type VerdictNarrative = {
  conclusion: string;
  reasons: string[];
};

const INSUFFICIENT_CONCLUSION = '返済の見通しを判断するための情報が不足しています。';

const millionText = (yen: number) =>
  (yen / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function verdictNarrativeOf(args: { debtEntered: boolean; years: CfYear[] }): VerdictNarrative {
  const { years } = args;
  if (!args.debtEntered) {
    return {
      conclusion: INSUFFICIENT_CONCLUSION,
      reasons: ['既存借入・新規借入・配当の入力がないため、返済の見通しは評価していません。'],
    };
  }
  if (years.length === 0) {
    return { conclusion: INSUFFICIENT_CONCLUSION, reasons: ['推計年度がないため、判定できません。'] };
  }

  const yearList = (list: CfYear[]) => list.map((y) => `${y.year}年`).join('、');
  const shortYears = years.filter((y) => y.verdict.startsWith('資金不足'));
  const dscrYears = years.filter((y) => y.verdict.startsWith('返済原資'));
  const heldYears = years.filter((y) => y.verdict.startsWith('評価保留'));
  const noServiceOnly = years.every((y) => y.verdict.startsWith('返済予定なし'));

  const reasons: string[] = [];
  for (const y of dscrYears) reasons.push(repaymentReasonOf(y));
  for (const y of shortYears) {
    const shortfall = y.postShortfall.value;
    const amount = typeof shortfall === 'number' && shortfall > 0 ? `（不足額 ${millionText(shortfall)} 百万円）` : '';
    reasons.push(`${y.year}年は、借入や返済を反映したあとの手元のお金が、手元に残しておきたいお金を下回っています${amount}。`);
  }
  if (heldYears.length > 0) {
    reasons.push(`評価保留の年度（${yearList(heldYears)}）があるため、判定は完了していません。`);
  }

  const conclusions: string[] = [];
  if (dscrYears.length > 0) {
    conclusions.push(
      `${yearList(dscrYears)}は、事業から生まれるお金に利息の支払い分を加えても、借入の返済額（元本と利息）を賄えない見込みです。`,
    );
  }
  if (shortYears.length > 0) {
    conclusions.push(
      `${yearList(shortYears)}は、借入や返済を反映したあとの手元のお金が、手元に残しておきたいお金を下回る見込みです。`,
    );
  }
  if (conclusions.length > 0) return { conclusion: conclusions.join(''), reasons };
  if (heldYears.length > 0) return { conclusion: INSUFFICIENT_CONCLUSION, reasons };
  if (noServiceOnly) {
    return { conclusion: '借入の元利返済の予定がないため、返済余力の判定対象はありません。', reasons };
  }
  return {
    conclusion:
      '計算上は、利息の支払い分を加えた事業から生まれるお金で借入の返済額を賄える見込みで、手元のお金も最低必要額を下回っていません。',
    reasons: [...reasons, '計算上の結果であり、計画の実現や金融機関の審査結果を保証するものではありません。'],
  };
}

function repaymentReasonOf(y: CfYear): string {
  const ocf = y.operatingCf.value;
  const interest = y.interest.value;
  const debtService = y.debtService.value;
  if (typeof ocf !== 'number' || typeof interest !== 'number' || typeof debtService !== 'number') {
    return `${y.year}年は、事業から生まれるお金に利息の支払い分を加えても、借入の返済額に届いていません。`;
  }
  const debtServiceText = `年間の元利返済額（${millionText(debtService)}百万円）`;
  if (ocf < 0) {
    return `${y.year}年は、事業から生まれるお金がマイナス（${millionText(ocf)}百万円）で、${debtServiceText}を賄えていません。`;
  }
  return `${y.year}年は、事業から生まれるお金（${millionText(ocf)}百万円）に利息の支払い分（${millionText(interest)}百万円）を加えても、${debtServiceText}に届いていません。`;
}

export type SaveStatus = 'SAVING' | 'FAILED' | 'UNSAVED' | 'STALE' | 'SAVED' | 'NOT_SAVED';

export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  SAVING: '保存中',
  FAILED: '保存失敗',
  UNSAVED: '未保存の変更あり',
  STALE: '保存後に計算の前提が変わった状態',
  SAVED: '保存済み',
  NOT_SAVED: '保存済みの計画はありません',
};

export function deriveSaveStatus(args: {
  saving: boolean;
  failed: boolean;
  unsaved: boolean;
  freshness: Freshness;
}): SaveStatus {
  if (args.saving) return 'SAVING';
  if (args.failed) return 'FAILED';
  if (args.unsaved) return 'UNSAVED';
  if (args.freshness.kind === 'STALE') return 'STALE';
  if (args.freshness.kind === 'CURRENT') return 'SAVED';
  return 'NOT_SAVED';
}

export type OverallVerdict = {
  label: string;
  tone: 'ok' | 'warn' | 'hold';
};

export function overallVerdictOf(outlook: RepaymentOutlook): OverallVerdict {
  switch (outlook.label) {
    case '資金不足あり':
      return { label: '資金不足あり', tone: 'warn' };
    case '返済余力が不足':
      return { label: '返済余力が不足', tone: 'warn' };
    case '評価保留':
      return { label: '評価保留', tone: 'hold' };
    default:
      return { label: '判定可能', tone: 'ok' };
  }
}

export function needsAttention(item: InvestmentItem): boolean {
  if (item.duplicateStatus === 'DERIVED' || item.duplicateStatus === 'SAME_DUPLICATE') return false;
  return !item.ready;
}

export function attentionSummary(items: readonly InvestmentItem[]): {
  count: number;
  yen: number;
  unconvertedCount: number;
} {
  let count = 0;
  let yen = 0;
  let unconvertedCount = 0;
  for (const item of items) {
    if (!needsAttention(item)) continue;
    count++;
    if (item.totalYen === null) unconvertedCount++;
    else yen += item.totalYen;
  }
  return { count, yen, unconvertedCount };
}

const SCALE_WARN_FACTOR = 1000;
const RATIO_WARN_FACTOR = 10;

export function amountScaleWarning(args: { valueMillionYen: number | null; baseRevenueYen: number | null }): string | null {
  const { valueMillionYen, baseRevenueYen } = args;
  if (valueMillionYen === null || baseRevenueYen === null || baseRevenueYen <= 0) return null;
  if (valueMillionYen * 1_000_000 <= baseRevenueYen * SCALE_WARN_FACTOR) return null;
  return '入力額が大きくなっています。単位が百万円であることをご確認ください。';
}

export function ratioScaleWarning(args: { enteredPercent: number | null; basePercent: number | null }): string | null {
  const { enteredPercent, basePercent } = args;
  if (enteredPercent === null || basePercent === null || enteredPercent <= 0 || basePercent <= 0) return null;
  if (enteredPercent >= basePercent * RATIO_WARN_FACTOR || enteredPercent <= basePercent / RATIO_WARN_FACTOR) {
    return `基準年度の比率（約${Math.round(basePercent * 10) / 10}%）と大きく異なります。%単位をご確認ください。`;
  }
  return null;
}
