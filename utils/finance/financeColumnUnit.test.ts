import {
  FINANCE_OPERATING_PROFIT_COLUMN_BASES,
  FINANCE_SALES_COLUMN_BASES,
  findMoneyColumns,
  normalizeColumnKey,
  selectMoneyInMillion,
  toMillion,
} from './financeColumnUnit';

describe('列名の単位判定（数値の大きさでは判定しない）', () => {
  it('括弧内の単位を列名から読み取り、空白・括弧を無視する', () => {
    expect(normalizeColumnKey('売上高（千円）')).toBe('売上高千円');
    expect(normalizeColumnKey('Sales_Revenue (万円)')).toBe('salesrevenue万円');
  });

  it('円・千円・万円・百万円の同額（5百万円）は同じ百万円値になる', () => {
    const yen = selectMoneyInMillion(findMoneyColumns({ '売上高(円)': 5_000_000 }, FINANCE_SALES_COLUMN_BASES));
    const thousand = selectMoneyInMillion(findMoneyColumns({ '売上高(千円)': 5_000 }, FINANCE_SALES_COLUMN_BASES));
    const man = selectMoneyInMillion(findMoneyColumns({ '売上高(万円)': 500 }, FINANCE_SALES_COLUMN_BASES));
    const million = selectMoneyInMillion(findMoneyColumns({ '売上高(百万円)': 5 }, FINANCE_SALES_COLUMN_BASES));
    expect([yen, thousand, man, million].map((x) => x?.valueMillion)).toEqual([5, 5, 5, 5]);
  });

  it('営業利益(千円)・営業利益(万円)・営業利益(百万円)を百万円に換算する', () => {
    const pick = (row: Record<string, unknown>) =>
      selectMoneyInMillion(findMoneyColumns(row, FINANCE_OPERATING_PROFIT_COLUMN_BASES))?.valueMillion;
    expect(pick({ '営業利益(千円)': 2_000 })).toBe(2);
    expect(pick({ '営業利益(万円)': 200 })).toBe(2);
    expect(pick({ '営業利益(百万円)': 2 })).toBe(2);
  });

  it('売上高と営業利益を取り違えない', () => {
    const row = { '営業利益(百万円)': 2, '売上高(百万円)': 10 };
    expect(selectMoneyInMillion(findMoneyColumns(row, FINANCE_SALES_COLUMN_BASES))?.valueMillion).toBe(10);
    expect(selectMoneyInMillion(findMoneyColumns(row, FINANCE_OPERATING_PROFIT_COLUMN_BASES))?.valueMillion).toBe(2);
  });

  it('売上原価・売上総利益などを売上高として扱わない', () => {
    const row = { '売上原価(百万円)': 100, '売上総利益(百万円)': 40 };
    expect(selectMoneyInMillion(findMoneyColumns(row, FINANCE_SALES_COLUMN_BASES))).toBeNull();
  });

  it('売上高(千円)と売上高(百万円)が併存する場合は、明示された百万円列を優先する', () => {
    const row = { '売上高(千円)': 5_000, '売上高(百万円)': 5 };
    const picked = selectMoneyInMillion(findMoneyColumns(row, FINANCE_SALES_COLUMN_BASES));
    expect(picked?.unit).toBe('million_yen');
    expect(picked?.valueMillion).toBe(5);
  });

  it('単位なしの列と明示単位の列が併存する場合は、明示単位の列を優先する', () => {
    const row = { '売上高': 999, '売上高(千円)': 5_000 };
    const picked = selectMoneyInMillion(findMoneyColumns(row, FINANCE_SALES_COLUMN_BASES));
    expect(picked?.unit).toBe('thousand_yen');
    expect(picked?.valueMillion).toBe(5);
  });

  it('未対応の単位（千万円・億円）は金額にしない（他の単位として誤認しない）', () => {
    expect(selectMoneyInMillion(findMoneyColumns({ '売上(千万円)': 3 }, FINANCE_SALES_COLUMN_BASES))).toBeNull();
    expect(selectMoneyInMillion(findMoneyColumns({ '売上(億円)': 1 }, FINANCE_SALES_COLUMN_BASES))).toBeNull();
  });

  it('未対応の単位と明示された単位が併存する場合は、明示された単位だけを使う', () => {
    const row = { '売上(千万円)': 3, '売上高(百万円)': 5 };
    expect(selectMoneyInMillion(findMoneyColumns(row, FINANCE_SALES_COLUMN_BASES))?.valueMillion).toBe(5);
  });

  it('値が文字列（カンマ付き）でも数値として読む。数値でない値は無視する', () => {
    expect(selectMoneyInMillion(findMoneyColumns({ '売上高(千円)': '5,000' }, FINANCE_SALES_COLUMN_BASES))?.valueMillion).toBe(5);
    expect(selectMoneyInMillion(findMoneyColumns({ '売上高(千円)': 'abc' }, FINANCE_SALES_COLUMN_BASES))).toBeNull();
  });

  it('既存の百万円列（単位が明示されたもの）の結果は変わらない', () => {
    expect(toMillion(5, 'million_yen')).toBe(5);
    expect(toMillion(12.345, 'million_yen')).toBe(12.345);
  });
});
