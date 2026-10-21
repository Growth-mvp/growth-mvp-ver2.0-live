/* eslint-disable @typescript-eslint/no-explicit-any -- テストデータは型を緩くしている */
import {
  FINANCE_CURRENCY_NOTICE,
  addConfirmedSegmentIds,
  confirmedSegmentNames,
  formatSegmentMoneyForPrompt,
  formatYenForPrompt,
  hasFinancePLYearIssue,
  isSameFinanceRow,
  nonYenUnitInSheetText,
  nonYenUnitOfLabel,
  nonYenUnitsBySource,
  normalizeConfirmedSegmentIds,
  partiallyUpdatedLegacyYears,
  plYearConfirmedPredicate,
  pruneConfirmedSegmentIds,
  rekeySegmentRecord,
  sourcesWithoutUnitNotation,
} from './financeInputUnits';

describe('会社PLの年度判定', () => {
  it('年度の欠落・重複を検出する', () => {
    expect(hasFinancePLYearIssue([{ year: 2024 }, { year: 2025 }])).toBe(false);
    expect(hasFinancePLYearIssue([{ year: 2024 }, { year: 2024 }])).toBe(true);
    expect(hasFinancePLYearIssue([{ year: 2024 }, {}])).toBe(true);
    expect(hasFinancePLYearIssue([{ year: '2024' }, { year: 2024 }])).toBe(true);
  });

  it('円で確定した年度の一覧だけを確定とみなし、一覧が無い旧データは全年度を未確定とみなす', () => {
    const perYear = plYearConfirmedPredicate({ financeUnitConfirmed: { pl: [2026] } });
    expect(perYear(2026)).toBe(true);
    expect(perYear(2025)).toBe(false);
    expect(plYearConfirmedPredicate({})(2025)).toBe(false);
  });

  it('行の値の比較は値で行う', () => {
    expect(isSameFinanceRow({ year: 2024, revenue: 1 }, { year: 2024, revenue: 1 })).toBe(true);
    expect(isSameFinanceRow({ year: 2024, revenue: 1 }, { year: 2024, revenue: 2 })).toBe(false);
  });
});

describe('旧年度の一部更新の判定（未変更の項目を換算値で書き換えない）', () => {
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

  it('変わっていない行は対象にしない', () => {
    expect(partiallyUpdatedLegacyYears(prev, prev, legacy)).toEqual([]);
  });
});

describe('AIへ渡す円の表記', () => {
  it('単位が確定している金額は、百万円は100万で割って単位つきで表記する（小額は円のまま）', () => {
    expect(formatSegmentMoneyForPrompt('売上', 5_000_000, true)).toBe('売上5百万円');
    expect(formatSegmentMoneyForPrompt('営業利益', 500_000, true)).toBe('営業利益500000円');
    expect(formatYenForPrompt(25_000_000)).toBe('25百万円');
  });

  it('単位が未確定の金額は数値を出さず、未確認である旨を記載する', () => {
    const text = formatSegmentMoneyForPrompt('売上', 5_000_000, false);
    expect(text).toContain('単位未確認');
    expect(text).not.toContain('5');
    expect(formatSegmentMoneyForPrompt('売上', null, true)).toBe('');
  });
});

describe('セグメントの確定IDと名称変更・削除', () => {
  const A = { id: 'seg-a', name: 'A事業' };
  const B = { id: 'seg-b', name: 'B事業' };

  it('旧形式の共通フラグ true は確定IDとして数えない', () => {
    expect(normalizeConfirmedSegmentIds(true)).toEqual([]);
    expect(normalizeConfirmedSegmentIds(undefined)).toEqual([]);
    expect(normalizeConfirmedSegmentIds(['seg-a', 'seg-a', '', 3])).toEqual(['seg-a']);
  });

  it('名前で指定したセグメントのIDだけを確定に加える', () => {
    expect(addConfirmedSegmentIds(undefined, [A, B], ['A事業'])).toEqual(['seg-a']);
    expect(addConfirmedSegmentIds(['seg-b'], [A, B], ['A事業'])).toEqual(['seg-b', 'seg-a']);
  });

  it('確定IDは名前ではなくセグメントの現在の名前へ対応づける', () => {
    expect(confirmedSegmentNames([A, B], ['seg-b'])).toEqual(new Set(['B事業']));
  });

  it('名称変更では同じIDのデータを新しい名前へ移し、確定IDは変えない', () => {
    const renamed = { id: 'seg-a', name: 'A事業（改称）' };
    const data = { A事業: [{ year: 2025, revenue: 1 }], B事業: [{ year: 2025, revenue: 2 }] };
    expect(rekeySegmentRecord(data, [A, B], [renamed, B])).toEqual({
      'A事業（改称）': [{ year: 2025, revenue: 1 }],
      B事業: [{ year: 2025, revenue: 2 }],
    });
    expect(pruneConfirmedSegmentIds(['seg-a', 'seg-b'], [renamed, B])).toEqual(['seg-a', 'seg-b']);
  });

  it('削除されたセグメントのデータと確定IDは残さない', () => {
    const data = { A事業: [{ year: 2025, revenue: 1 }], B事業: [{ year: 2025, revenue: 2 }] };
    expect(rekeySegmentRecord(data, [A, B], [B])).toEqual({ B事業: [{ year: 2025, revenue: 2 }] });
    expect(pruneConfirmedSegmentIds(['seg-a', 'seg-b'], [B])).toEqual(['seg-b']);
  });

  it('削除後に同じ名前で追加したセグメントは、前のセグメントの確定を引き継がない', () => {
    const readded = { id: 'seg-c', name: 'A事業' };
    expect(pruneConfirmedSegmentIds(['seg-a'], [B, readded])).toEqual([]);
    expect(confirmedSegmentNames([B, readded], [])).toEqual(new Set());
  });
});

describe('取込資料の円以外の単位表記（検出して取込を止める）', () => {
  it('列見出しの末尾の単位を検出する（千円・万円・百万円・千万円・億円）', () => {
    expect(nonYenUnitOfLabel('売上高（千円）')).toBe('千円');
    expect(nonYenUnitOfLabel('営業利益(万円)')).toBe('万円');
    expect(nonYenUnitOfLabel('売上高(百万円)')).toBe('百万円');
    expect(nonYenUnitOfLabel('売上高(千万円)')).toBe('千万円');
    expect(nonYenUnitOfLabel('売上高（億円）')).toBe('億円');
    expect(nonYenUnitOfLabel('売上高')).toBeUndefined();
  });

  it('資料内の「単位：○○」表記を検出する。本文中の単位語は検出しない', () => {
    expect(nonYenUnitInSheetText('単位：千円')).toBe('千円');
    expect(nonYenUnitInSheetText('(単位 百万円)')).toBe('百万円');
    expect(nonYenUnitInSheetText('当社は売上100億円の企業です')).toBeUndefined();
  });

  it('取込元ごとの円以外の単位と、円の確認が必要な取込元を分けて判定する', () => {
    const candidates = [
      { kind: 'companyPL', source: 'a.csv', sheetUnit: '千円' },
      { kind: 'segmentPL', source: 'b.csv', fieldUnits: { revenue: '万円' } },
      { kind: 'companyBS', source: 'c.csv' },
      { kind: 'pbr', source: 'd.csv' },
    ];
    expect(nonYenUnitsBySource(candidates)).toEqual({ 'a.csv': ['千円'], 'b.csv': ['万円'] });
    expect(sourcesWithoutUnitNotation(candidates)).toEqual(['c.csv']);
  });

  it('円単位の確認文言を持つ', () => {
    expect(FINANCE_CURRENCY_NOTICE).toContain('円単位で入力してください');
  });
});
