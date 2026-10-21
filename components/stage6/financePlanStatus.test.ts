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
  moveLabelOf,
  overallVerdictOf,
  ratioScaleWarning,
  repaymentOutlook,
  verdictNarrativeOf,
} from './financePlanStatus';

describe('FINANCE_TABS', () => {
  it('目標に届くかから計画は成り立つかまでの5タブを順に並べる', () => {
    expect(FINANCE_TABS.map((t) => t.key)).toEqual(['target', 'investment', 'cashflow', 'debt', 'verdict']);
    expect(FINANCE_TABS.map((t) => t.label)).toEqual([
      '1. 目標に届くか',
      '2. いくら必要か',
      '3. お金は足りるか',
      '4. 借入・返済を考える',
      '5. 計画は成り立つか',
    ]);
  });

  it('各タブに説明文を持たせる', () => {
    for (const tab of FINANCE_TABS) {
      expect(tab.description.length).toBeGreaterThan(0);
    }
  });

  it('移動ボタンはタブの表示名を使う', () => {
    expect(moveLabelOf('investment')).toBe('「2. いくら必要か」へ移動');
  });
});

const forecastYear = (year: number, verdict: string): CfYear =>
  ({ year, kind: 'FORECAST', verdict, holds: [] }) as unknown as CfYear;

const detailedYear = (
  year: number,
  verdict: string,
  values: {
    dscr?: number | null;
    postShortfallYen?: number | null;
    ocfYen?: number | null;
    interestYen?: number | null;
    debtServiceYen?: number | null;
  } = {},
): CfYear =>
  ({
    year,
    kind: 'FORECAST',
    verdict,
    holds: [],
    dscr: { value: values.dscr ?? null, basis: 'ESTIMATE' },
    postShortfall: { value: values.postShortfallYen ?? null, basis: 'ESTIMATE' },
    operatingCf: { value: values.ocfYen ?? null, basis: 'ESTIMATE' },
    interest: { value: values.interestYen ?? null, basis: 'ESTIMATE' },
    debtService: { value: values.debtServiceYen ?? null, basis: 'ESTIMATE' },
  }) as unknown as CfYear;

describe('verdictNarrativeOf', () => {
  it('借入が未入力なら返済の見通しを判断できないと示す', () => {
    const r = verdictNarrativeOf({ debtEntered: false, years: [forecastYear(2027, '計算上は問題なし')] });
    expect(r.conclusion).toBe('返済の見通しを判断するための情報が不足しています。');
  });

  it('資金不足の年度を結論にし、不足額を理由に示す', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [detailedYear(2028, '資金不足（返済後の現預金が最低必要現預金を下回る）', { postShortfallYen: 150_000_000 })],
    });
    expect(r.conclusion).toBe('2028年は、借入や返済を反映したあとの手元のお金が、手元に残しておきたいお金を下回る見込みです。');
    expect(r.reasons).toEqual([
      '2028年は、借入や返済を反映したあとの手元のお金が、手元に残しておきたいお金を下回っています（不足額 150.0 百万円）。',
    ]);
  });

  it('簡易DSCRが1倍未満の年度は、利息を加えても返済額に届かないことを、算式どおりの文章で示す', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [
        detailedYear(2027, '返済原資が元利返済を下回る（DSCR 1倍未満）', {
          dscr: 0.85,
          ocfYen: 80_000_000,
          interestYen: 20_000_000,
          debtServiceYen: 150_000_000,
        }),
      ],
    });
    expect(r.conclusion).toBe(
      '2027年は、事業から生まれるお金に利息の支払い分を加えても、借入の返済額（元本と利息）を賄えない見込みです。',
    );
    expect(r.reasons).toEqual([
      '2027年は、事業から生まれるお金（80.0百万円）に利息の支払い分（20.0百万円）を加えても、年間の元利返済額（150.0百万円）に届いていません。',
    ]);
  });

  it('営業CFがマイナスの年度は、マイナスであることを事実として示す', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [
        detailedYear(2027, '返済原資が元利返済を下回る（DSCR 1倍未満）', {
          dscr: -29.93,
          ocfYen: -50_000_000,
          interestYen: 10_000_000,
          debtServiceYen: 30_000_000,
        }),
      ],
    });
    expect(r.reasons).toEqual([
      '2027年は、事業から生まれるお金がマイナス（-50.0百万円）で、年間の元利返済額（30.0百万円）を賄えていません。',
    ]);
  });

  it('返済余力の不足と手元資金の不足が両方あれば、両方を結論に含める', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [
        detailedYear(2027, '返済原資が元利返済を下回る（DSCR 1倍未満）', { dscr: 0.8, ocfYen: 1, interestYen: 1, debtServiceYen: 3 }),
        detailedYear(2028, '資金不足（返済後の現預金が最低必要現預金を下回る）', { postShortfallYen: 10_000_000 }),
      ],
    });
    expect(r.conclusion).toContain('2027年は、事業から生まれるお金に利息の支払い分を加えても');
    expect(r.conclusion).toContain('2028年は、借入や返済を反映したあとの手元のお金が');
  });

  it('評価保留の年度があれば、問題なしとせず判定未完了と示す', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [
        detailedYear(2027, '評価保留'),
        detailedYear(2028, '計算上は資金不足・DSCR不足なし（簡易指標。金融機関の審査指標とは異なります）'),
      ],
    });
    expect(r.conclusion).toBe('返済の見通しを判断するための情報が不足しています。');
    expect(r.reasons).toEqual(['評価保留の年度（2027年）があるため、判定は完了していません。']);
  });

  it('問題のない年度だけなら、計算上の結果であり保証ではないことを併記する', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [detailedYear(2027, '計算上は資金不足・DSCR不足なし（簡易指標。金融機関の審査指標とは異なります）')],
    });
    expect(r.conclusion).toBe(
      '計算上は、利息の支払い分を加えた事業から生まれるお金で借入の返済額を賄える見込みで、手元のお金も最低必要額を下回っていません。',
    );
    expect(r.reasons.join('')).toContain('保証するものではありません');
  });

  it('元利返済がない年度だけなら返済余力の判定対象がないと示す', () => {
    const r = verdictNarrativeOf({
      debtEntered: true,
      years: [detailedYear(2027, '返済予定なし（DSCR算出不可）')],
    });
    expect(r.conclusion).toBe('借入の元利返済の予定がないため、返済余力の判定対象はありません。');
  });

  it('推計年度がなければ判定できないと示す', () => {
    const r = verdictNarrativeOf({ debtEntered: true, years: [] });
    expect(r.conclusion).toBe('返済の見通しを判断するための情報が不足しています。');
    expect(r.reasons).toEqual(['推計年度がないため、判定できません。']);
  });
});

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

  it('DSCRが1倍未満なら返済余力の不足として示す', () => {
    const r = repaymentOutlook({
      debtEntered: true,
      years: [forecastYear(2027, '返済原資が元利返済を下回る（DSCR 1倍未満）')],
    });
    expect(r.label).toBe('返済余力が不足');
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
    expect(overallVerdictOf({ label: '返済余力が不足', detail: '2027年', tone: 'warn' }).label).toBe('返済余力が不足');
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
