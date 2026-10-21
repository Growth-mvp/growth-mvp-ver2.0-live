/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
import { columnMoneyUnitOfLabel } from './financeColumnUnit';

describe('列名（見出し）からの単位判定', () => {
  it('列名の末尾に明示された単位を読み取る', () => {
    expect(columnMoneyUnitOfLabel('売上高(千円)')).toBe('thousand_yen');
    expect(columnMoneyUnitOfLabel('営業利益（万円）')).toBe('man_yen');
    expect(columnMoneyUnitOfLabel('売上(百万円)')).toBe('million_yen');
    expect(columnMoneyUnitOfLabel('売上高(円)')).toBe('yen');
  });

  it('単位が書かれていない列名は判定しない（null）', () => {
    expect(columnMoneyUnitOfLabel('売上高')).toBeNull();
  });

  it('未対応の単位は判定しない（別の単位として誤認しない）', () => {
    expect(columnMoneyUnitOfLabel('売上高(千万円)')).toBe('unsupported');
    expect(columnMoneyUnitOfLabel('売上高(億円)')).toBe('unsupported');
  });
});
