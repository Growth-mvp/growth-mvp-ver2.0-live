/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
jest.mock('server-only', () => ({}));

import { buildFinanceCsvUnitMeta, buildStateFromDbRow } from './strategy';

const YEN_CONFIRMED_CSV = {
  financeUnitConfirmed: { pl: [2024, 2025, 2026] },
  financeBS: [],
  segmentPL: {},
  segmentBS: {},
};

describe('STAGE1 財務値の復元（保存値をそのまま使い、桁で換算しない）', () => {
  it('円で確定した年度の会社PLは、桁で100万倍されない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000, operatingIncome: 200_000, cogs: 300_000 }],
      csv_finance_data: YEN_CONFIRMED_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000);
    expect(state.financePL[0].operatingIncome).toBe(200_000);
    expect(state.financePL[0].cogs).toBe(300_000);
  });

  it('円で確定した大きな値は変わらない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 1_234_567_890 }],
      csv_finance_data: YEN_CONFIRMED_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(1_234_567_890);
  });

  it('確認情報のない会社PLも、桁で換算せず保存値をそのまま使う（営業利益50万円は50万円のまま）', () => {
    const rows = [{ year: 2024, revenue: 500, operatingIncome: 500_000 }];
    const state = buildStateFromDbRow({ finance_pl: rows, csv_finance_data: {} }) as any;
    expect(state.financePL[0]).toStrictEqual({ year: 2024, revenue: 500, operatingIncome: 500_000 });
    expect(state).not.toHaveProperty('legacyFinancePLRaw');
    expect(rows).toEqual([{ year: 2024, revenue: 500, operatingIncome: 500_000 }]);
  });

  it('読込後の年度の記録は読み込んだ年度の一覧で、保存時に単位の選択は含めない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }, { year: 2025, revenue: 300 }],
      csv_finance_data: {},
    }) as any;
    expect(state.financeUnitConfirmed).toEqual({ pl: [2024, 2025], bs: false, segmentPL: [], segmentBS: [] });
    expect(buildFinanceCsvUnitMeta(state)).toEqual({ financeUnitConfirmed: { pl: [2024, 2025], segmentPL: [], segmentBS: [] } });
  });

  it('一部の年度だけ確定情報があっても、他の年度の値は換算されない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [
        { year: 2024, revenue: 500_000 },
        { year: 2025, revenue: 300 },
        { year: 2026, revenue: 500_000 },
      ],
      csv_finance_data: { financeUnitConfirmed: { pl: [2026] } },
    }) as any;
    expect(state.financePL.map((r: any) => r.revenue)).toEqual([500_000, 300, 500_000]);
  });

  it('年度の重複がある会社PLも、保存値をそのまま読む（保存の停止は store が行う）', () => {
    const state = buildStateFromDbRow({
      finance_pl: [
        { year: 2025, revenue: 300 },
        { year: 2025, revenue: 400 },
      ],
      csv_finance_data: {},
    }) as any;
    expect(state.financePL.map((r: any) => r.revenue)).toEqual([300, 400]);
    expect(state).not.toHaveProperty('legacyFinancePLRaw');
  });

  it('新規の円建て保存は確定年度として書かれ、再読込で換算されない', () => {
    const meta = buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2024] } } as any);
    expect(meta).toEqual({ financeUnitConfirmed: { pl: [2024] } });
    const reloaded = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: meta,
    }) as any;
    expect(reloaded.financePL[0].revenue).toBe(500_000);
  });

  it('旧データの保存メタに、取込単位や単位の選択は書かれない', () => {
    expect(buildFinanceCsvUnitMeta({} as any)).toEqual({});
  });
});

describe('会社PL・BSの確定メタ（保存の仕方）', () => {
  it('会社PLを書く保存は確定年度の一覧を置き換え、書かない保存では既存の一覧を残す', () => {
    expect(
      buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2026] } } as any, { financeUnitConfirmed: { pl: [2024] } }),
    ).toEqual({ financeUnitConfirmed: { pl: [2026] } });
    expect(
      buildFinanceCsvUnitMeta({ financeUnitConfirmed: { bs: true } } as any, { financeUnitConfirmed: { pl: [2024] } }),
    ).toEqual({ financeUnitConfirmed: { pl: [2024], bs: true } });
  });

  it('保存時の確定状態は既存DBのBS・セグメントの確定を取り消さない', () => {
    expect(buildFinanceCsvUnitMeta({} as any, { financeUnitConfirmed: { bs: true } })).toEqual({
      financeUnitConfirmed: { bs: true },
    });
  });
});

describe('セグメントの確定（セグメントIDごと）', () => {
  it('確定したセグメントIDは再読込後も同じIDだけが残る', () => {
    const meta = buildFinanceCsvUnitMeta({
      financeUnitConfirmed: { pl: [], segmentPL: ['seg-a'], segmentBS: ['seg-b'] },
    } as any);
    const state = buildStateFromDbRow({ finance_pl: [], csv_finance_data: meta }) as any;
    expect(state.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(state.financeUnitConfirmed.segmentBS).toEqual(['seg-b']);
  });

  it('旧形式の共通フラグ true は、どのセグメントの確定としても扱わない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { financeUnitConfirmed: { segmentPL: true, segmentBS: true } },
    }) as any;
    expect(state.financeUnitConfirmed.segmentPL).toEqual([]);
    expect(state.financeUnitConfirmed.segmentBS).toEqual([]);
  });

  it('会社ごとのセグメント確定は、読み込んだ会社のCSVだけから決まる', () => {
    const companyA = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { financeUnitConfirmed: { segmentPL: ['seg-a'] } },
    }) as any;
    const companyB = buildStateFromDbRow({ finance_pl: [], csv_finance_data: {} }) as any;
    expect(companyA.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(companyB.financeUnitConfirmed.segmentPL).toEqual([]);
  });

  it('セグメント確定を状態から書くと一覧で置き換わり、削除済みセグメントの確定は残らない', () => {
    const meta = buildFinanceCsvUnitMeta(
      { financeUnitConfirmed: { segmentPL: ['seg-b'] } } as any,
      { financeUnitConfirmed: { segmentPL: ['seg-a', 'seg-b'] } },
    );
    expect(meta.financeUnitConfirmed).toEqual({ segmentPL: ['seg-b'] });
  });

  it('セグメント確定が未読込の状態で保存しても、既存のセグメント確定を消さない', () => {
    const meta = buildFinanceCsvUnitMeta({} as any, { financeUnitConfirmed: { segmentPL: ['seg-a'] } });
    expect(meta.financeUnitConfirmed).toEqual({ segmentPL: ['seg-a'] });
  });
});

describe('旧年度の読込で欠損項目を0円に補完しない', () => {
  const legacyState = (row: Record<string, unknown>) =>
    buildStateFromDbRow({ finance_pl: [{ year: 2025, ...row }], csv_finance_data: {} }) as any;

  it.each(['revenue', 'operatingIncome', 'cogs', 'sga', 'grossProfit'])(
    '欠損した %s はキーのまま欠損として残る',
    (field) => {
      const row: Record<string, unknown> = { revenue: 500_000, operatingIncome: 20_000, cogs: 300_000, sga: 40_000, grossProfit: 60_000 };
      delete row[field];
      const pl = legacyState(row).financePL[0];
      expect(pl).not.toHaveProperty(field);
    },
  );

  it('null は0円に変えず null のまま残す', () => {
    const pl = legacyState({ revenue: 500_000, grossProfit: null }).financePL[0];
    expect(pl.grossProfit).toBeNull();
  });

  it('明示的な0円は0円のまま残す', () => {
    const pl = legacyState({ revenue: 500_000, operatingIncome: 0 }).financePL[0];
    expect(pl.operatingIncome).toBe(0);
  });

  it('100万円未満の値も桁で換算せず、保存値のまま使う', () => {
    const pl = legacyState({ revenue: 300, operatingIncome: 500_000 }).financePL[0];
    expect(pl.revenue).toBe(300);
    expect(pl.operatingIncome).toBe(500_000);
  });

  it('文字列で保存された値は、換算も数値化もせずそのまま残す', () => {
    const pl = legacyState({ revenue: '2000' }).financePL[0];
    expect(pl.revenue).toBe('2000');
  });

  it('円確認済みの年度では欠損は欠損のまま、値も変えない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2025, revenue: 500_000, cogs: 300_000 }],
      csv_finance_data: { financeUnitConfirmed: { pl: [2025] } },
    }) as any;
    expect(state.financePL[0]).toStrictEqual({ year: 2025, revenue: 500_000, cogs: 300_000 });
  });
});

describe('STAGE6と銀行向け計画書の数値の一致（円単位の旧データ）', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bankPlan = require('@/utils/stage6/bankFinancialPlan') as typeof import('@/utils/stage6/bankFinancialPlan');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cashflow = require('@/utils/stage6/cashflow') as typeof import('@/utils/stage6/cashflow');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const snapshot = require('@/utils/stage6/financePlanSnapshot') as typeof import('@/utils/stage6/financePlanSnapshot');

  const ASSUMPTIONS = {
    minCashYen: 400_000_000, taxRate: 0.3, depreciationYen: null, arRatio: null, inventoryRatio: null, apRatio: null,
    targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null,
  } as any;
  const BS = [{ year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000 }];

  function compare(pl: any[]) {
    const state = buildStateFromDbRow({ finance_pl: pl, csv_finance_data: { financeBS: BS } }) as any;
    const plan = cashflow.buildCashFlowPlan({
      financePL: state.financePL,
      financeBS: BS as any,
      investment: { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      assumptions: ASSUMPTIONS,
    }, 2026);
    const domain = { assumptions: ASSUMPTIONS, existingLoans: [], newLoans: [], dividendsYen: {} } as any;
    const stored = snapshot.buildStoredFinancePlan({
      domain, companyId: 'c1', savedAt: '2026-10-21T00:00:00Z',
      meta: { calcVersion: 'phase4a-v1', companyId: 'c1', baseYear: 2025, bsBaseYear: 2025, assumptionsHash: snapshot.hashOf(snapshot.toSavedFinancePlan(domain)), sourceHash: 'x' } as any,
    });
    const bank = bankPlan.bankFinancialPlanForRow({
      row: { id: 's1', finance_pl: pl, csv_finance_data: { financeBS: BS, financePlanAssumptions: stored }, departments: [], company_targets: [], fiscal_year_end: '12' } as any,
      companyId: 'c1',
      now: new Date('2026-10-22T00:00:00Z'),
    }) as any;
    return { plan, bank };
  }

  it('円の少額・高額データのどちらでも、基準年度と推計年度の売上・営業利益・営業CFが計画書とSTAGE6で一致する', () => {
    for (const oi of [500_000, 100_000_000]) {
      const { plan, bank } = compare([
        { year: 2025, revenue: 1_200_000_000, operatingIncome: oi, interest: 5_000_000, depreciation: 20_000_000, tax: 0, netIncome: 0 },
      ]);
      const targets = bank.sections.financialTargets;
      expect(targets.baseYearRevenueYen).toBe(plan.years[0].revenue.value);
      expect(targets.baseYearOperatingIncomeYen).toBe(oi);
      for (const y of plan.years.filter((p) => p.kind === 'FORECAST')) {
        const bankYear = bank.sections.cashFlow.years.find((b: any) => b.year === y.year);
        expect(bankYear.operatingCf.value).toBeCloseTo(y.operatingCf.value as number, 0);
      }
    }
  });

  it('営業利益の欠損は、計画書でも0円にせず、STAGE6と同じく評価保留になる', () => {
    const { plan, bank } = compare([
      { year: 2025, revenue: 1_200_000_000, interest: 5_000_000, depreciation: 20_000_000, tax: 0, netIncome: 0 },
    ]);
    expect(bank.sections.financialTargets.baseYearOperatingIncomeYen).toBeNull();
    expect(plan.years.find((p) => p.kind === 'FORECAST')?.operatingCf.value).toBeNull();
    expect(bank.sections.cashFlow.years.find((b: any) => b.kind === 'FORECAST').operatingCf.value).toBeNull();
  });
});
