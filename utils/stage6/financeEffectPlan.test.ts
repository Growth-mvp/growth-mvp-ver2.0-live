import type { Department } from '@/types/strategy';
import { guardFinanceEffectConfirmation, normalizeFinanceEffect } from '@/lib/financeEffect';
import { buildFinanceEffectTrial } from './financeEffectPlan';

const FY = [2026, 2027, 2028];

const dept = (name: string, projects: unknown[]) => ({ id: name, name, projects }) as unknown as Department;
const proj = (title: string, financeEffect?: unknown, extra: Record<string, unknown> = {}) => ({
  id: title,
  title,
  role: 'REVENUE',
  financeEffect,
  ...extra,
});
const base = { confirmed: true, sourceNote: '見積書（架空）' };

const yearsOf = (t: ReturnType<typeof buildFinanceEffectTrial>) =>
  t.years.map((y) => [y.fiscalYear, y.revenueYen, y.operatingEffectYen]);

describe('STAGE4→6 財務効果の条件付き試算（決算3月・架空企業）', () => {
  it('A 売上増加のみ：年額1,200万円、2026年6月開始 → FY2027は10か月分、FY2028は12か月分。営業利益は未算定', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('営業部', [proj('新規開拓', { ...base, kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 12_000_000, amountBasis: 'ANNUAL', startYm: '2026-06' })])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 10_000_000, 0],
      [2028, 12_000_000, 0],
    ]);
    expect(t.revenueCostUnknown).toEqual([{ deptName: '営業部', projectTitle: '新規開拓' }]);
  });

  it('B 費用削減のみ：月額10万円、2026年4月〜2027年3月 → FY2027のみ120万円', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('工程改善', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 100_000, amountBasis: 'MONTHLY', startYm: '2026-04', endYm: '2027-03' })])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 0, 1_200_000],
      [2028, 0, 0],
    ]);
  });

  it('C 追加費用のみ：一回限り300万円、2026年10月〜2027年3月（6か月均等）→ FY2027に−300万円、合計は一致', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('設備保守の外注', { ...base, kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 3_000_000, amountBasis: 'TOTAL', startYm: '2026-10', endYm: '2027-03' })])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 0, -3_000_000],
      [2028, 0, 0],
    ]);
    expect(t.years.reduce((s, y) => s + y.operatingEffectYen, 0)).toBe(-3_000_000);
  });

  it('D 翌年度から発生：年額120万円、2027年4月開始 → FY2026・FY2027は0、FY2028に120万円', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('管理部', [proj('間接費の見直し', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2027-04' })])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 0, 0],
      [2028, 0, 1_200_000],
    ]);
  });

  it('E 複数施策の共存：旧来の金額は加算せず参照のみ', () => {
    const t = buildFinanceEffectTrial({
      departments: [
        dept('製造部', [proj('工程改善', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 100_000, amountBasis: 'MONTHLY', startYm: '2026-04' })]),
        dept('営業部', [proj('新規開拓', { ...base, kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 6_000_000, amountBasis: 'ANNUAL', startYm: '2026-04' }, { impactRevenueMJPY: 50 })]),
      ],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 6_000_000, 1_200_000],
      [2028, 6_000_000, 1_200_000],
    ]);
    expect(t.legacyReferenced).toEqual([{ deptName: '営業部', projectTitle: '新規開拓' }]);
  });

  it('F 確認済み・未確認・入力不足・非財務が混在：確認済みの1件だけ試算に入り、理由を一覧にする', () => {
    const t = buildFinanceEffectTrial({
      departments: [
        dept('製造部', [
          proj('工程改善', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' }),
          proj('下書き', { ...base, confirmed: false, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 2_400_000, amountBasis: 'ANNUAL', startYm: '2026-04' }),
        ]),
        dept('営業部', [
          proj('根拠なし', { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 9_000_000, amountBasis: 'ANNUAL', startYm: '2026-04', confirmed: true }),
          proj('社内向け', { kind: 'NOT_FINANCIAL', confirmed: true }),
        ]),
      ],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 0, 1_200_000],
      [2028, 0, 1_200_000],
    ]);
    expect(t.excluded.map((e) => e.projectTitle)).toEqual(['下書き', '根拠なし', '社内向け']);
    expect(t.excluded[0].reason).toContain('未確認');
    expect(t.excluded[1].reason).toContain('算定根拠・出所');
    expect(t.excluded[2].reason).toContain('非財務');
  });

  it('G 保存・再読込・施策の改名と並べ替え：試算結果は変わらない', () => {
    const effectA = { ...base, kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 6_000_000, amountBasis: 'ANNUAL', startYm: '2026-04' };
    const effectB = { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 100_000, amountBasis: 'MONTHLY', startYm: '2026-04' };
    const before = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('工程改善', effectB)]), dept('営業部', [proj('新規開拓', effectA)])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    const reloaded = JSON.parse(JSON.stringify([effectA, effectB])).map((e: unknown) => normalizeFinanceEffect(e));
    const after = buildFinanceEffectTrial({
      departments: [
        dept('営業部（改名）', [proj('新規開拓・改', reloaded[0])]),
        dept('製造部', [proj('工程改善', reloaded[1])]),
      ],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(after)).toEqual(yearsOf(before));
    expect(after.included).toHaveLength(2);
  });

  it('確認済みの金額を変更すると確認が解除され、試算から外れる（変更の反映）', () => {
    const confirmed = { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' };
    const released = guardFinanceEffectConfirmation(confirmed, { ...confirmed, directAmountYen: 2_400_000 });
    expect(released?.confirmed).toBe(false);
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('工程改善', released)])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(t.included).toEqual([]);
    expect(t.excluded[0].reason).toContain('未確認');
    expect(yearsOf(t).every(([, r, o]) => r === 0 && o === 0)).toBe(true);
  });

  it('一回限りの効果で終了時期がなければ、全額を開始月に計上する', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('設備撤去', { ...base, kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'TOTAL', startYm: '2027-02' })])],
      fiscalYearEnd: '3',
      fiscalYears: FY,
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 0],
      [2027, 0, -500_000],
      [2028, 0, 0],
    ]);
  });

  it('決算月が未設定なら試算せず、ready=false を返す', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('工程改善', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' })])],
      fiscalYearEnd: undefined,
      fiscalYears: FY,
    });
    expect(t.ready).toBe(false);
    expect(t.years).toEqual([]);
  });

  it('決算月12月では、2026年1月開始の年額は FY2026 に入る', () => {
    const t = buildFinanceEffectTrial({
      departments: [dept('製造部', [proj('工程改善', { ...base, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-01' })])],
      fiscalYearEnd: '12',
      fiscalYears: [2026, 2027],
    });
    expect(yearsOf(t)).toEqual([
      [2026, 0, 1_200_000],
      [2027, 0, 1_200_000],
    ]);
  });
});
