import type { CashFlowPlan, CfYear } from '@/utils/stage6/cashflow';
import type { DebtSchedule } from '@/utils/stage6/debt';
import type { Freshness } from '@/utils/stage6/financePlanSnapshot';
import type { InvestmentItem } from '@/utils/stage6/investmentDemand';
import type { InvestmentSummary } from './financePlanStatus';
import {
  FINANCE_TABS,
  amountScaleWarning,
  attentionSummary,
  buildUnconfirmedItems,
  deriveSaveStatus,
  overallVerdictOf,
  ratioScaleWarning,
  repaymentOutlook,
} from './financePlanStatus';

describe('FINANCE_TABS', () => {
  it('目標・施策効果から財務判定までの5タブを順に並べる', () => {
    expect(FINANCE_TABS.map((t) => t.key)).toEqual(['target', 'investment', 'cashflow', 'debt', 'verdict']);
  });
});

const forecastYear = (year: number, verdict: string): CfYear =>
  ({ year, kind: 'FORECAST', verdict, holds: [] }) as unknown as CfYear;

describe('repaymentOutlook', () => {
  it('借入が未入力なら評価保留にする', () => {
    expect(repaymentOutlook({ debtEntered: false, years: [forecastYear(2027, '計算上は問題なし')] }).label).toBe(
      '評価保留',
    );
  });

  it('資金不足の年度を年度付きで示す', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [
        forecastYear(2027, '計算上は資金不足・DSCR不足なし（簡易指標。金融機関の審査指標とは異なります）'),
        forecastYear(2028, '資金不足（返済後の現預金が最低必要現預金を下回る）'),
      ],
    });
    expect(r).toEqual({ label: '資金不足あり', detail: '2028年', tone: 'warn' });
  });

  it('DSCRが1倍未満なら返済原資不足として示す', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [forecastYear(2027, '返済原資が元利返済を下回る（DSCR 1倍未満）')],
    });
    expect(r.label).toBe('DSCR 1倍未満');
    expect(r.tone).toBe('warn');
  });

  it('一部でも評価保留があれば問題なしとはしない', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [forecastYear(2027, '評価保留'), forecastYear(2028, '計算上は資金不足・DSCR不足なし')],
    });
    expect(r).toMatchObject({ label: '評価保留', detail: '2027年', tone: 'hold' });
  });

  it('全年度が返済予定なしならDSCR算出不可として示す', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [forecastYear(2027, '返済予定なし（DSCR算出不可）')],
    });
    expect(r.label).toBe('返済予定なし');
  });

  it('問題のない年度のみなら簡易判定として示す', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [forecastYear(2027, '計算上は資金不足・DSCR不足なし（簡易指標。金融機関の審査指標とは異なります）')],
    });
    expect(r).toMatchObject({ label: '計算上の問題なし', tone: 'ok' });
  });
});

describe('deriveSaveStatus', () => {
  const current: Freshness = { kind: 'CURRENT', hasUnconfirmed: false };
  const stale: Freshness = { kind: 'STALE', reasons: ['入力前提が変わりました'] };
  const none: Freshness = { kind: 'NO_SAVED' };

  it('保存中を最優先にする', () => {
    expect(deriveSaveStatus({ saving: true, failed: true, unsaved: true, freshness: stale })).toBe('SAVING');
  });

  it('保存失敗は未保存の変更より優先する', () => {
    expect(deriveSaveStatus({ saving: false, failed: true, unsaved: true, freshness: current })).toBe('FAILED');
  });

  it('未保存の変更があればそれを示す', () => {
    expect(deriveSaveStatus({ saving: false, failed: false, unsaved: true, freshness: current })).toBe('UNSAVED');
  });

  it('保存後に前提が変わっていれば前提変更として示す', () => {
    expect(deriveSaveStatus({ saving: false, failed: false, unsaved: false, freshness: stale })).toBe('STALE');
  });

  it('一致していれば保存済み、保存がなければ未保存', () => {
    expect(deriveSaveStatus({ saving: false, failed: false, unsaved: false, freshness: current })).toBe('SAVED');
    expect(deriveSaveStatus({ saving: false, failed: false, unsaved: false, freshness: none })).toBe('NOT_SAVED');
  });
});

describe('buildUnconfirmedItems', () => {
  const investment = {
    fiscalYearEndMonth: 3,
    unclassifiedCount: 0,
    unscheduledYen: 0,
    periodicUnresolvedCount: 0,
    candidateCount: 2,
    basisPendingCount: 0,
    unitPendingCount: 0,
    missingCount: 0,
    unapprovedReadyYen: 500,
  } as unknown as InvestmentSummary;
  const plan = { yearMismatch: false, years: [] } as unknown as CashFlowPlan;
  const schedule = { reconciliation: { status: 'MATCH' }, years: [] } as unknown as DebtSchedule;

  it('判定に影響する事項を参考事項より前に並べ、対応タブを割り当てる', () => {
    const items = buildUnconfirmedItems({
      investment,
      existingLoanCount: 0,
      debtEntered: false,
      minCashEntered: true,
      plan,
      schedule,
    });
    expect(items.map((i) => i.key)).toEqual(['debt-existing', 'inv-candidate', 'inv-unapproved']);
    expect(items.map((i) => i.tab)).toEqual(['debt', 'investment', 'investment']);
    expect(items.map((i) => i.required)).toEqual([true, true, false]);
  });

  it('入力済みで計算の不足もなければ未確認事項はない', () => {
    const items = buildUnconfirmedItems({
      investment: { ...investment, candidateCount: 0, unapprovedReadyYen: 0 } as unknown as InvestmentSummary,
      existingLoanCount: 1,
      debtEntered: true,
      minCashEntered: true,
      plan,
      schedule,
    });
    expect(items).toEqual([]);
  });

  it('最低必要現預金が未入力ならキャッシュフロータブの必須事項にする', () => {
    const items = buildUnconfirmedItems({
      investment: { ...investment, candidateCount: 0, unapprovedReadyYen: 0 } as unknown as InvestmentSummary,
      existingLoanCount: 1,
      debtEntered: true,
      minCashEntered: false,
      plan,
      schedule,
    });
    expect(items).toEqual([expect.objectContaining({ key: 'cf-mincash', tab: 'cashflow', required: true })]);
  });
});

describe('attentionSummary', () => {
  const item = (over: Record<string, unknown>) =>
    ({ duplicateStatus: 'NONE', ready: false, totalYen: null, ...over }) as unknown as InvestmentItem;

  it('確認済みと派生値・重複除外済みは未確定に含めない', () => {
    const items = [
      item({ ready: true, totalYen: 900 }),
      item({ duplicateStatus: 'DERIVED', totalYen: 500 }),
      item({ duplicateStatus: 'SAME_DUPLICATE', totalYen: 300 }),
    ];
    expect(attentionSummary(items)).toEqual({ count: 0, yen: 0, unconvertedCount: 0 });
  });

  it('未確定の項目を一度ずつ合算し、換算できない項目は件数だけ数える', () => {
    const items = [
      item({ totalYen: 100 }),
      item({ duplicateStatus: 'CANDIDATE', totalYen: 200 }),
      item({ totalYen: null }),
    ];
    expect(attentionSummary(items)).toEqual({ count: 3, yen: 300, unconvertedCount: 1 });
  });
});

describe('overallVerdictOf', () => {
  it('既存の判定結果を総合判定に対応づける', () => {
    expect(overallVerdictOf({ label: '資金不足あり', detail: '2028年', tone: 'warn' }).label).toBe('資金不足あり');
    expect(overallVerdictOf({ label: 'DSCR 1倍未満', detail: '2027年', tone: 'warn' }).label).toBe('返済原資が不足');
    expect(overallVerdictOf({ label: '評価保留', detail: '', tone: 'hold' })).toEqual({ label: '評価保留', tone: 'hold' });
    expect(overallVerdictOf({ label: '計算上の問題なし', detail: '', tone: 'ok' })).toEqual({
      label: '判定可能',
      tone: 'ok',
    });
  });
});

describe('amountScaleWarning', () => {
  it('基準年度売上の1000倍を超える入力だけ警告する', () => {
    const base = 1_000_000_000; // 10億円（円）
    expect(amountScaleWarning({ valueMillionYen: 1000, baseRevenueYen: base })).toBeNull();
    expect(amountScaleWarning({ valueMillionYen: 2_000_000, baseRevenueYen: base })).not.toBeNull();
  });

  it('基準値がなければ警告しない', () => {
    expect(amountScaleWarning({ valueMillionYen: 2_000_000, baseRevenueYen: null })).toBeNull();
    expect(amountScaleWarning({ valueMillionYen: null, baseRevenueYen: 1_000_000_000 })).toBeNull();
  });
});

describe('ratioScaleWarning', () => {
  it('基準年度の比率と10倍以上離れた入力だけ警告する', () => {
    expect(ratioScaleWarning({ enteredPercent: 30, basePercent: 25 })).toBeNull();
    expect(ratioScaleWarning({ enteredPercent: 0.3, basePercent: 30 })).not.toBeNull();
    expect(ratioScaleWarning({ enteredPercent: 3000, basePercent: 30 })).not.toBeNull();
  });

  it('基準比率がない場合や0は警告しない', () => {
    expect(ratioScaleWarning({ enteredPercent: 30, basePercent: null })).toBeNull();
    expect(ratioScaleWarning({ enteredPercent: 0, basePercent: 30 })).toBeNull();
  });
});
