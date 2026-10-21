/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
import {
  FINANCE_INPUT_UNITS,
  FINANCE_UNIT_VERSION,
  convertCandidateFieldsToYen,
  resolveCandidatesToYen,
  displayNumber,
  isFinanceInputUnit,
  hasFinancePLYearIssue,
  isSameFinanceRow,
  partiallyUpdatedLegacyYears,
  plYearConfirmedPredicate,
  scaleMonetaryRows,
  toYen,
  toYenRowsKeepingUnchanged,
} from './financeInputUnits';

describe('財務金額の入力単位（円へ正規化）', () => {
  it('対応する入力単位は、円・千円・万円・百万円・億円の5種類', () => {
    expect(FINANCE_INPUT_UNITS).toEqual(['yen', 'thousand_yen', 'man_yen', 'million_yen', 'oku_yen']);
    expect(FINANCE_UNIT_VERSION).toBe(2);
    expect(isFinanceInputUnit('million_yen')).toBe(true);
    expect(isFinanceInputUnit('mjpy')).toBe(false);
    expect(isFinanceInputUnit(undefined)).toBe(false);
  });

  it('同じ金額（15億円）は、どの入力単位で入力しても同じ円の値になる', () => {
    expect(toYen(1_500_000_000, 'yen')).toBe(1_500_000_000);
    expect(toYen(1_500_000, 'thousand_yen')).toBe(1_500_000_000);
    expect(toYen(150_000, 'man_yen')).toBe(1_500_000_000);
    expect(toYen(1_500, 'million_yen')).toBe(1_500_000_000);
    expect(toYen(15, 'oku_yen')).toBe(1_500_000_000);
  });

  it('円建ての少額（50万円）は100万倍されず、そのまま50万円として扱われる', () => {
    expect(toYen(500_000, 'yen')).toBe(500_000);
  });

  it('入力値は円の整数に丸める（小数の百万円でも1円未満は持たない）', () => {
    expect(toYen(0.1234567, 'million_yen')).toBe(123_457);
  });

  it('表示用の換算: 円の値を選択した単位の数値に直す（金額は変えない）', () => {
    const yen = 1_500_000_000;
    expect(displayNumber(yen, 'million_yen')).toBe(1_500);
    expect(displayNumber(yen, 'thousand_yen')).toBe(1_500_000);
    expect(displayNumber(yen, 'man_yen')).toBe(150_000);
    expect(displayNumber(yen, 'oku_yen')).toBe(15);
    expect(displayNumber(yen, 'yen')).toBe(yen);
  });

  it('表示の数値を入力し直しても、同じ金額に戻る（往復で誤差を生じない）', () => {
    const yen = 1_234_567;
    const shown = displayNumber(yen, 'million_yen');
    expect(toYen(shown, 'million_yen')).toBe(yen);
  });

  it('単位を切り替えても保存値（円）は変わらず、表示数値だけ換算される', () => {
    const saved = [{ year: 2024, revenue: 1_500_000_000 }];
    const shownInMillion = scaleMonetaryRows(saved, 'million_yen', 'display');
    const shownInThousand = scaleMonetaryRows(saved, 'thousand_yen', 'display');
    expect(shownInMillion[0].revenue).toBe(1_500);
    expect(shownInThousand[0].revenue).toBe(1_500_000);
    expect(scaleMonetaryRows(shownInThousand, 'thousand_yen', 'yen')[0].revenue).toBe(1_500_000_000);
    expect(saved[0].revenue).toBe(1_500_000_000);
  });

  it('行の金額項目だけを換算し、年度は変えない（未入力の項目は作らない）', () => {
    const rows = scaleMonetaryRows(
      [{ year: 2024, revenue: 1.5, operatingIncome: 0.2 }] as any[],
      'million_yen',
      'yen',
    );
    expect(rows[0]).toEqual({ year: 2024, revenue: 1_500_000, operatingIncome: 200_000 });
    expect('cogs' in rows[0]).toBe(false);
  });

  it('列ごとに明示された単位を優先し、無い列は全体の単位を使う。どちらも無い列は換算しない', () => {
    const result = convertCandidateFieldsToYen(
      { revenue: 5_000, operatingIncome: 200, sga: 40 },
      { operatingIncome: 'man_yen' },
      'thousand_yen',
    );
    expect(result.yenFields).toEqual({ revenue: 5_000_000, operatingIncome: 2_000_000, sga: 40_000 });
    expect(result.unresolvedKeys).toEqual([]);

    const unresolved = convertCandidateFieldsToYen({ revenue: 5_000 }, {}, undefined);
    expect(unresolved.yenFields).toEqual({});
    expect(unresolved.unresolvedKeys).toEqual(['revenue']);
  });
});

describe('取込候補の円への換算（単位の優先順位）', () => {
  it('列の明示単位を優先し、無い列は取込元で確定した単位を使う', () => {
    const { candidates, unresolvedCount } = resolveCandidatesToYen(
      [
        {
          kind: 'companyPL',
          source: '決算.xlsx',
          fields: { revenue: 5_000, operatingIncome: 200 },
          fieldUnits: { operatingIncome: 'man_yen' },
        },
      ],
      { '決算.xlsx': 'thousand_yen' },
    );
    expect(candidates[0].fields).toEqual({ revenue: 5_000_000, operatingIncome: 2_000_000 });
    expect(unresolvedCount).toBe(0);
  });

  it('単位が確定していない金額は換算せず、未確定として数える（捏造しない）', () => {
    const { candidates, unresolvedCount } = resolveCandidatesToYen(
      [{ kind: 'companyBS', source: 'x.pdf', fields: { ar: 500_000, cash: 300_000 } }],
      {},
    );
    expect(candidates[0].fields).toEqual({});
    expect(unresolvedCount).toBe(2);
  });

  it('金額以外の候補（PBRなど）は換算も未確定の判定もしない', () => {
    const { candidates, unresolvedCount } = resolveCandidatesToYen(
      [{ kind: 'pbr', source: 'x.pdf', fields: { pbr: 1.2 } }],
      {},
    );
    expect(candidates[0].fields).toEqual({ pbr: 1.2 });
    expect(unresolvedCount).toBe(0);
  });
});

describe('表の編集結果の円換算（未編集の年度は保存値を維持する）', () => {
  it('表示値が変わっていない年度は、保存済みの円の行をそのまま使う（往復誤差で値が変わらない）', () => {
    const prevYen = [
      { year: 2024, revenue: 1234567.8 },
      { year: 2025, revenue: 1_000_000 },
    ];
    const prevDisplay = scaleMonetaryRows(prevYen, 'million_yen', 'display');
    const nextDisplay = prevDisplay.map((r) => (r.year === 2025 ? { ...r, revenue: 2 } : { ...r }));
    const out = toYenRowsKeepingUnchanged(nextDisplay, prevDisplay, prevYen, 'million_yen');
    expect(out[0]).toBe(prevYen[0]);
    expect(out[1]).toEqual({ year: 2025, revenue: 2_000_000 });
  });

  it('変更された年度は、表示単位から円へ換算した値になる', () => {
    const prevYen = [{ year: 2026, revenue: 500_000 }];
    const prevDisplay = scaleMonetaryRows(prevYen, 'thousand_yen', 'display');
    const out = toYenRowsKeepingUnchanged([{ year: 2026, revenue: 700 }], prevDisplay, prevYen, 'thousand_yen');
    expect(out).toEqual([{ year: 2026, revenue: 700_000 }]);
  });
});

describe('会社PLの年度判定', () => {
  it('年度の欠落・重複を検出する', () => {
    expect(hasFinancePLYearIssue([{ year: 2024 }, { year: 2025 }])).toBe(false);
    expect(hasFinancePLYearIssue([{ year: 2024 }, { year: 2024 }])).toBe(true);
    expect(hasFinancePLYearIssue([{ year: 2024 }, {}])).toBe(true);
    expect(hasFinancePLYearIssue([{ year: '2024' }, { year: 2024 }])).toBe(true);
  });

  it('確定年度の一覧は年度ごとに判定し、一覧がなければ全年度を未確定とみなす', () => {
    const perYear = plYearConfirmedPredicate({ financeUnitConfirmed: { pl: [2026] } });
    expect(perYear(2026)).toBe(true);
    expect(perYear(2025)).toBe(false);
    expect(plYearConfirmedPredicate({})(2025)).toBe(false);
    expect(plYearConfirmedPredicate({ financeUnitVersion: 2 })(2025)).toBe(true);
  });

  it('行の値の比較は値で行う', () => {
    expect(isSameFinanceRow({ year: 2024, revenue: 1 }, { year: 2024, revenue: 1 })).toBe(true);
    expect(isSameFinanceRow({ year: 2024, revenue: 1 }, { year: 2024, revenue: 2 })).toBe(false);
  });
});

describe('旧年度の部分更新の判定', () => {
  const legacy = [{ year: 2024, revenue: 500_000, operatingIncome: 20_000 }];
  const prev = [{ year: 2024, revenue: 500_000_000_000, operatingIncome: 20_000_000_000, cogs: 0 }];

  it('旧年度の項目の一部だけが変わった場合は、その年度を返す', () => {
    const next = [{ ...prev[0], revenue: 600_000_000_000 }];
    expect(partiallyUpdatedLegacyYears(next, prev, legacy)).toEqual([2024]);
  });

  it('旧年度の必要項目をすべて変えた場合は、部分更新として扱わない', () => {
    const next = [{ ...prev[0], revenue: 600_000, operatingIncome: 30_000, cogs: 0 }];
    expect(partiallyUpdatedLegacyYears(next, prev, legacy)).toEqual([]);
  });

  it('変わっていない行、確定済みの年度、新しい年度は対象にしない', () => {
    expect(partiallyUpdatedLegacyYears(prev, prev, legacy)).toEqual([]);
    const yen = [{ year: 2024, revenue: 600_000 }];
    expect(partiallyUpdatedLegacyYears([{ year: 2024, revenue: 700_000 }], yen, [])).toEqual([]);
    expect(partiallyUpdatedLegacyYears([...prev, { year: 2025, revenue: 1 }], prev, legacy)).toEqual([]);
  });
});
