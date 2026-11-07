import { normalizeApprovalWording } from './approvalWording';
import { toBusinessWording } from './businessWording';

describe('承認を確認できない目標の表現（社員向けの実例）', () => {
  it.each([
    ['公式な財務目標として、2029年の売上を示します。', '登録された財務目標として、2029年の売上を示します。'],
    ['この数値は公式目標として扱います。', 'この数値は登録目標として扱います。'],
    ['2029年の目標は正式決定済みです。', '2029年の目標は登録済み（承認状態は未確認）です。'],
    ['公式な全社売上目標は130,000百万円です。', '登録された全社売上目標は130,000百万円です。'],
  ])('%s を登録状態の表現にする', (input, expected) => {
    expect(normalizeApprovalWording(input)).toBe(expected);
  });

  it('既に登録状態と明記された文は変えない', () => {
    const text = '登録された財務目標（承認状態は未確認）として示します。';
    expect(normalizeApprovalWording(text)).toBe(text);
  });
});

describe('英語の見込み表現', () => {
  it('estimates を「見込み」にする', () => {
    expect(toBusinessWording('期待効果は estimates として扱います。')).toBe('期待効果は 見込み として扱います。');
    expect(toBusinessWording('expected estimate of the effect')).toBe('expected 見込み of the effect');
  });
});
